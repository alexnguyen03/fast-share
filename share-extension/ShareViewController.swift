import UIKit
import UniformTypeIdentifiers

final class ShareViewController: UIViewController {
    private let groupId = "group.com.alexnguyen03.fastshare"

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        Task { await collect() }
    }

    private func collect() async {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupId) else {
            finish()
            return
        }
        let inbox = container.appendingPathComponent("incoming", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        } catch {
            finish()
            return
        }

        var names: [String] = []
        let items = extensionContext?.inputItems as? [NSExtensionItem] ?? []
        for item in items {
            for provider in item.attachments ?? [] {
                if let name = await store(provider, in: inbox, index: names.count) {
                    names.append(name)
                }
            }
        }

        let manifest = ["images": names]
        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            try? data.write(to: inbox.appendingPathComponent("manifest.json"))
        }
        openHost()
        finish()
    }

    private func store(_ provider: NSItemProvider, in inbox: URL, index: Int) async -> String? {
        let type = UTType.image.identifier
        guard provider.hasItemConformingToTypeIdentifier(type) else { return nil }
        return await withCheckedContinuation { continuation in
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                guard let url else {
                    continuation.resume(returning: nil)
                    return
                }
                if let name = storeOriginalImage(from: url, in: inbox, index: index) {
                    continuation.resume(returning: name)
                    return
                }
                continuation.resume(returning: nil)
            }
        }
    }

    private func storeOriginalImage(from url: URL, in inbox: URL, index: Int) -> String? {
        let ext = (url.pathExtension.lowercased())
        let supported = ["png", "jpg", "jpeg", "gif", "webp"]
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }

        let name = "shared-\(index).\(supported.contains(ext) ? ext : "png")"
        let destination = inbox.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: destination)

        if supported.contains(ext), let data = try? Data(contentsOf: url) {
            do {
                try data.write(to: destination, options: .atomic)
                return name
            } catch {
                return nil
            }
        }

        guard let image = UIImage(data: (try? Data(contentsOf: url)) ?? Data()),
              let png = image.pngData() else { return nil }
        do {
            try png.write(to: destination, options: .atomic)
            return name
        } catch {
            return nil
        }
    }

    private func openHost() {
        guard let url = URL(string: "fastshare://share") else { return }
        extensionContext?.open(url, completionHandler: nil)
    }

    private func finish() {
        extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
    }
}
