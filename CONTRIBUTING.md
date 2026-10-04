# Contributing

Thanks for helping with Fast Share.

## Before you change behavior

1. Read `.cursor/skills/fast-share-architecture/SKILL.md`.
2. If the change affects pairing or image upload, update `docs/protocol.md` first.
3. Host behavior (accept a device, receive images, copy, purge history, update settings) needs a Rust test before the implementation. Tests should use fake ports, not a live system tray.
4. The UI calls Tauri commands. It does not open sockets or write the history folder.

## Pull requests

`main` accepts changes only through a pull request. A review is required, stale reviews are dismissed after new commits, and review conversations need to be resolved before merge. Direct pushes and force pushes to `main` are blocked.

Describe what changed, how you tried it, and any risk to image handling or device pairing.

Do not attach real screenshots, session tokens, or QR payloads. Use synthetic images.

Run the checks from `.cursor/skills/verify-slice/SKILL.md` when the Tauri project exists. If you touch `src-tauri`, review the change against `.cursor/rules/rust-host.mdc`. If you touch `src`, review it against `.cursor/rules/typescript-ui.mdc`. If you touch the network or files, use `.cursor/skills/host-security/SKILL.md`.

## Reports

Bugs and feature ideas use the GitHub issue templates. Vulnerability reports go through [GitHub Security Advisories](SECURITY.md), not a public issue.
