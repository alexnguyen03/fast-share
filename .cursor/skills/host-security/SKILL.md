---
name: host-security
description: Review Fast Share pairing, image upload, file storage, clipboard, and history changes for local-network abuse. Use when those paths change.
---

# Host security

Use this when changing pairing, upload, file storage, the clipboard, or history. Skip generic web checks that this app does not have: SQL, CSRF, cookies, and blockchain.

## Checklist

- The computer rejects a phone it has not accepted.
- The QR token expires and cannot be replayed after forget or expiry.
- The certificate fingerprint from the QR is pinned for that computer.
- Nothing in the transfer path sends the image to a host outside the LAN.
- The size limit is enforced before the file is written.
- The payload is stored only after it decodes as an image.
- The client filename is not used as a path.
- The destination path stays inside the app data directory.
- `settings.json` is not inside the image folder that purge deletes.
- A settings patch rejects unknown keys and values outside 1 to 90 days.
- Logs and notifications do not include tokens, QR payloads, or image bytes.
- The lock-screen notification does not preview the image.
- Tests cover reject-unknown, oversize, undecodable bytes, and a lowered retention purge.
