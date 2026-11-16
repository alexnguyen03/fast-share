import AppIntents
import UIKit

@available(iOS 16.0, *)
private enum FastShareIntentError: Error, CustomLocalizedStringResourceConvertible {
    case noImagesSelected
    case appGroupUnavailable
    case couldNotStoreImages

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .noImagesSelected:
            return "Select at least one screenshot or image first."
        case .appGroupUnavailable:
            return "Fast Share cannot open its shared inbox. Reinstall the signed Fast Share app."
        case .couldNotStoreImages:
            return "Fast Share could not prepare the selected images."
        }
    }
}

@available(iOS 16.0, *)
struct SendImagesIntent: AppIntent {
    static let title: LocalizedStringResource = "Send Images to Fast Share"
    static let description = IntentDescription(
        "Send one or more screenshots or images to Fast Share. The images open in the editor; the computer is chosen there before delivery.",
        categoryName: "Sharing",
        searchKeywords: ["fast share", "share", "send", "screenshot", "computer"]
    )
    static let openAppWhenRun = true

    @Parameter(
        title: "Images",
        description: "Screenshots or images to send.",
        supportedTypeIdentifiers: ["public.image"]
    )
    var images: [IntentFile]

    func perform() async throws -> some IntentResult {
        try await MainActor.run {
            try writeIncomingImages()
        }
        return .result()
    }

    private func writeIncomingImages() throws {
        let incoming: URL
        if let container = FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: "group.com.alexnguyen03.fastshare"
        ) {
            incoming = container.appendingPathComponent("incoming", isDirectory: true)
        } else {
            // AppIntents run in the app process, so work inside the app data
            // directory when the app group entitlement is unavailable.
            guard let support = FileManager.default.urls(
                for: .applicationSupportDirectory,
                in: .userDomainMask
            ).first,
            let bundleID = Bundle.main.bundleIdentifier else {
                throw FastShareIntentError.appGroupUnavailable
            }
            incoming = support
                .appendingPathComponent(bundleID, isDirectory: true)
                .appendingPathComponent("incoming", isDirectory: true)
        }

        try FileManager.default.createDirectory(at: incoming, withIntermediateDirectories: true)

        var names: [String] = []
        for image in images {
            let name = "shared-\(names.count).jpg"
            let destination = incoming.appendingPathComponent(name)
            try? FileManager.default.removeItem(at: destination)

            guard let sourceImage = UIImage(data: image.data),
                  let jpeg = sourceImage.jpegData(compressionQuality: 0.92)
            else {
                continue
            }

            try jpeg.write(to: destination, options: [.atomic, .completeFileProtectionUnlessOpen])
            names.append(name)
        }

        guard !names.isEmpty else {
            if images.isEmpty {
                throw FastShareIntentError.noImagesSelected
            }
            throw FastShareIntentError.couldNotStoreImages
        }

        try JSONSerialization.data(withJSONObject: ["images": names]).write(
            to: incoming.appendingPathComponent("manifest.json"),
            options: .atomic
        )
    }
}

@available(iOS 16.0, *)
struct FastShareShortcutsProvider: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: SendImagesIntent(),
            phrases: [
                "Send images to \(.applicationName)",
                "Share screenshots with \(.applicationName)",
            ],
            shortTitle: "Send images",
            systemImageName: "paperplane.fill"
        )
    }
}
