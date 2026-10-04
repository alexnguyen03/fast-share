# Protocol

Fast Share moves images from a phone to one computer on the same Wi-Fi. The computer is the host. The phone never opens a public relay.

Identifiers are stable ids, not IP addresses. `DeviceId`, `PcId`, and `BatchId` are distinct types.

## Pairing

The computer shows a QR code the first time a phone should be trusted. The payload contains:

- the computer id and display name
- a currently reachable LAN address and port
- a one-time token
- the fingerprint of the computer's self-signed certificate
- an expiry time

The phone scans it. The computer must accept that phone before any image is stored. Both sides then remember the id and the display name.

A later visit does not need a new QR when the computer already trusts the phone, the Fast Share app is open, and both devices are on the same Wi-Fi. The phone discovers that computer with mDNS and the user picks it as the destination.

The computer rejects a phone it has not accepted. An expired QR cannot be reused. Forgetting a device removes trust, so the next visit needs a new QR.

One send has one destination computer. Switching destination does not move images already stored on the previous computer.

## Send a batch

The phone shares one or more images from Photos, edits them, then uploads the edited bytes.

The upload includes:

- the phone's device id and display name
- a batch id
- each image's index and bytes

The computer does not use the filename supplied by the phone. It accepts the batch only when every image is under the size limit and decodes as an image. It then acknowledges the batch.

If the computer app is closed, asleep, or not on the same Wi-Fi, the send fails on the phone and can be retried. The phone does not keep a silent queue.

## After receive

The computer writes each image under its app data directory, outside Desktop and Documents, and records the batch in history.

A batch with one image is copied to the clipboard. A batch with several images shows one notification and does not replace the clipboard. The user copies the selected history image.

The notification text is:

- `1 image from {phone}. Copied, ready to paste.`
- `{count} images from {phone}.`

The lock screen does not show the image contents. Choosing the notification opens that batch in history.

## Settings

Settings live in `settings.json` in the app data directory, separate from the image folder. The computer owns this file.

Each field has a default. An older file that lacks a new field still loads. A settings update is a partial patch. Unknown keys are rejected.

The first field is `history_retention_days`. The default is 7. Allowed values are 1 through 90. Lowering the value deletes images older than the new limit immediately. Raising it deletes nothing.

## UI copy

User-facing strings default to English in `src/shared/locales/en.ts`. A later `vi.ts` adds Vietnamese without changing components.
