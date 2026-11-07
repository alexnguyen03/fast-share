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
                let name = "shared-\(index).jpg"
                let destination = inbox.appendingPathComponent(name)
                try? FileManager.default.removeItem(at: destination)
                guard
                    let data = try? Data(contentsOf: url),
                    let image = UIImage(data: data),
                    let jpeg = image.jpegData(compressionQuality: 0.92)
                else {
                    continuation.resume(returning: nil)
                    return
                }
                do {
                    try jpeg.write(to: destination, options: .atomic)
                    continuation.resume(returning: name)
                } catch {
                    continuation.resume(returning: nil)
                }
            }
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
