# Protocol

Fast Share moves images from a phone to one computer on the same Wi-Fi. The computer is the host. The phone never opens a public relay.

Identifiers are stable ids, not IP addresses. `DeviceId`, `PcId`, and `BatchId` are distinct types.

## Pairing

The computer shows a QR code the first time a phone should be trusted. The payload is JSON, version 1:

- `pcId` and `name`
- `host` and `port`, a private IPv4 address on the LAN (loopback is allowed only on the same machine)
- `token`, a one-time pairing token that expires 10 minutes after it is issued
- `fingerprint`, the lowercase SHA-256 hex of the computer's certificate DER
- `certDer`, the standard-base64 DER of that certificate, so the phone can pin it
- `expiresAt`, an RFC3339 timestamp

The phone rejects the payload when the fingerprint does not match `certDer`, the host is not a LAN address, or the token is already expired. The phone then calls `POST /pair` with `token`, `deviceId`, and `name`.

The computer must accept that phone before any image is stored. `POST /pair` returns `pending` and a `pollToken`. After the computer accepts, `POST /pair/status` with that poll token returns the shared secret once and then forgets the poll token. Both sides then remember the id and the display name. The secret is not shown in the UI and is not written into notifications.

A later visit does not need a new QR when the computer already trusts the phone, the Fast Share app is open, and both devices are on the same Wi-Fi. The computer advertises `_fastshare._tcp.local.` The TXT record contains `id` and `name` only, never the token or the secret. The phone discovers that computer and the user picks it as the destination. The phone may also probe `GET /ready` on a remembered LAN address when multicast is blocked.

The computer rejects a phone it has not accepted. An expired QR cannot be reused. Forgetting a device removes trust, so the next visit needs a new QR.

One send has one destination computer. Switching destination does not move images already stored on the previous computer.

## Send a batch

The phone shares one or more images from Photos, edits them, then uploads the edited bytes.

The upload is `POST /batches` on the pinned HTTPS port. The JSON body contains:

- `deviceId` and `secret`
- `batchId`
- `images`, an array of standard-base64 image bytes

There is no client filename. The computer accepts the batch only when the phone is trusted, the secret matches, every image is at most 20 MiB, neither dimension exceeds 8192, and every image decodes. It validates the whole batch before writing any file, re-encodes each image as PNG, and names the file `image-{imageId}.png`. The HTTP body is limited to 100 MiB. The response is `{ "ok": true, "imageCount": N }`.

`GET /ready` answers `{ "ok": true }` so a remembered phone can see that the app is open. It carries no token and no image.

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

The first field is `historyRetentionDays` in the JSON file (`history_retention_days` in Rust). The default is 7. Allowed values are 1 through 90. Lowering the value deletes images older than the new limit immediately. Raising it deletes nothing.

`pcDisplayName` defaults to `My PC`. A patch may send either field. Unknown keys are rejected. Loading an older file still fills missing fields from the defaults and ignores keys this version does not know.

## UI copy

User-facing strings default to English in `src/shared/locales/en.ts`. A later `vi.ts` adds Vietnamese without changing components.
