#!/usr/bin/env swift

import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!

    func applicationDidFinishLaunching(_ notification: Notification) {
        let title = NSTextField(labelWithString: "Resume actions")
        title.font = .boldSystemFont(ofSize: 15)
        title.alignment = .center

        let updateButton = makeButton(
            title: "Update resume.pdf",
            action: #selector(updateResume)
        )

        let openButton = makeButton(
            title: "Open Downloads",
            action: #selector(openDownloads)
        )

        let copyButton = makeButton(
            title: "Copy cover letter prompt",
            action: #selector(copyCoverLetterPrompt)
        )

        let cancelButton = makeButton(
            title: "Cancel",
            action: #selector(cancel)
        )

        let stack = NSStackView(
            views: [
                title,
                updateButton,
                openButton,
                copyButton,
                cancelButton
            ]
        )

        stack.orientation = .vertical
        stack.alignment = .centerX
        stack.spacing = 10
        stack.edgeInsets = NSEdgeInsets(
            top: 20,
            left: 20,
            bottom: 20,
            right: 20
        )

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 360, height: 270),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )

        window.title = "Resume Helper"
        window.contentView = stack
        window.center()
        window.makeKeyAndOrderFront(nil)

        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func makeButton(title: String, action: Selector) -> NSButton {
        let button = NSButton(
            title: title,
            target: self,
            action: action
        )

        button.bezelStyle = .rounded

        button.translatesAutoresizingMaskIntoConstraints = false
        button.widthAnchor.constraint(equalToConstant: 300).isActive = true
        button.heightAnchor.constraint(equalToConstant: 32).isActive = true

        return button
    }

    private var downloadsURL: URL {
        FileManager.default.urls(
            for: .downloadsDirectory,
            in: .userDomainMask
        )[0]
    }

    @objc private func updateResume() {
        let fileManager = FileManager.default

        do {
            let files = try fileManager.contentsOfDirectory(
                at: downloadsURL,
                includingPropertiesForKeys: [.contentModificationDateKey],
                options: [.skipsHiddenFiles]
            )

            let cvFiles = files.filter {
                $0.lastPathComponent.hasPrefix("cv-") &&
                $0.pathExtension.lowercased() == "pdf"
            }

            guard !cvFiles.isEmpty else {
                showMessage("No cv-*.pdf found in Downloads")
                return
            }

            let latestFile = try cvFiles.max { first, second in
                let firstDate = try first.resourceValues(
                    forKeys: [.contentModificationDateKey]
                ).contentModificationDate ?? .distantPast

                let secondDate = try second.resourceValues(
                    forKeys: [.contentModificationDateKey]
                ).contentModificationDate ?? .distantPast

                return firstDate < secondDate
            }!

            let targetURL = downloadsURL.appendingPathComponent("resume.pdf")

            if fileManager.fileExists(atPath: targetURL.path) {
                try fileManager.removeItem(at: targetURL)
            }

            try fileManager.copyItem(
                at: latestFile,
                to: targetURL
            )

            for file in cvFiles {
                try fileManager.trashItem(
                    at: file,
                    resultingItemURL: nil
                )
            }
        } catch {
            showMessage("Failed:\n\(error.localizedDescription)")
        }
    }

    @objc private func openDownloads() {
        NSWorkspace.shared.open(downloadsURL)
    }

    @objc private func copyCoverLetterPrompt() {
        let pasteboard = NSPasteboard.general

        pasteboard.clearContents()
        pasteboard.setString(
            "Give me a cover letter, but not in JSON. Use straight apostrophes.",
            forType: .string
        )
    }

    @objc private func cancel() {
        NSApplication.shared.terminate(nil)
    }

    private func showMessage(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Resume Helper"
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.addButton(withTitle: "OK")
        alert.runModal()
    }

    func applicationShouldTerminateAfterLastWindowClosed(
        _ sender: NSApplication
    ) -> Bool {
        true
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()

application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()