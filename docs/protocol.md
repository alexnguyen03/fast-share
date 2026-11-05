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

Alongside the QR code, the computer also shows a one-time 6-digit pairing code and its `IP:port`. A phone without a camera (or on an emulator) can enter that 6-digit code: it discovers the computer via mDNS (`_fastshare._tcp.local.`) or connects to the entered `IP:port` and calls `POST /pair/code` with `code`, `deviceId`, and `name`. The response returns the pairing status along with `pcId`, `name`, `fingerprint`, and `certDer` so the phone pins that certificate for all future requests.

When a connection fails, the phone reports the specific LAN cause:
- Different subnet / double NAT when the phone IPv4 and computer IPv4 are on different `/24` networks.
- Guest Wi-Fi / AP isolation or Windows Firewall when both devices are on the same subnet (`192.168.1.x`) but TCP is blocked.
- Filtered multicast (IGMP snooping) when mDNS returns no hosts on Wi-Fi, prompting the user to enter the `IP:port` shown under the QR code.
- On Windows, if the active network profile is `Public` and no inbound firewall rule exists for Fast Share, the desktop UI warns the user and offers a one-click action to add the firewall rule.

The computer must accept that phone before any image is stored. `POST /pair` returns `pending` and a `pollToken`. After the computer accepts, `POST /pair/status` with that poll token returns the shared secret once and then forgets the poll token. Both sides then remember the id and the display name. Scanning a QR code from a phone that the computer already trusts returns `trusted` without reissuing the secret and without consuming the one-time token; if the phone lost its stored secret, the user must forget the phone on the computer first and then scan again. The secret is not shown in the UI and is not written into notifications.

A later visit does not need a new QR when the computer already trusts the phone, the Fast Share app is open, and both devices are on the same Wi-Fi. The desktop computer binds its listener to a private RFC1918 LAN IPv4 address (ignoring virtual adapters) and advertises `_fastshare._tcp.local.` Mobile clients never start the listener or advertise mDNS. The TXT record contains `id` and `name` only, never the token or the secret. When the phone resolves a remembered `pcId` on the LAN, it updates that computer's remembered LAN host and port before checking readiness or sending, while keeping the pinned certificate fingerprint.

The computer rejects a phone it has not accepted. An expired QR cannot be reused. Forgetting a device removes trust, so the next visit needs a new QR.

One send has one destination computer. Switching destination does not move images already stored on the previous computer.

## Send a batch

The phone shares one or more images from Photos, edits them, then uploads the edited bytes.

The upload is `POST /batches` on the pinned HTTPS port. The TLS client verifies that the server's leaf certificate SHA-256 fingerprint matches the pinned fingerprint and does not trust public WebPKI roots. The JSON body contains:

- `deviceId` and `secret`
- `batchId`
- `images`, an array of standard-base64 image bytes (1 through 20 images)

There is no client filename. The computer checks `deviceId`, `secret`, and the image count before decoding base64 or holding the store lock during image decoding. It accepts the batch only when the phone is trusted, the secret matches, the batch has at most 20 images, every image is at most 20 MiB, neither dimension exceeds 8192, and every image decodes. A repeated upload with the same `deviceId` and `batchId` is a no-op that returns `{ "ok": true, "imageCount": N }` without storing duplicates, overwriting the clipboard, or sending another notification. For a new batch, it validates the whole batch before writing any file, re-encodes each image as PNG, and names the file `image-{imageId}.png`. The HTTP body is limited to 100 MiB. The response is `{ "ok": true, "imageCount": N }`.

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

The first field is `historyRetentionDays` in the JSON file (`history_retention_days` in Rust). The default is 7. Allowed values are 1 through 90. Expired batches are purged when the store opens and periodically while the desktop host runs. Lowering the value deletes images older than the new limit immediately. Raising it deletes nothing. If `settings.json` on disk has an out-of-range value, loading clamps it back to 7 and rewrites the file.

`pcDisplayName` defaults to `My PC`. A patch may send either field. Unknown keys are rejected. Loading an older file still fills missing fields from the defaults and ignores keys this version does not know.

## UI copy

User-facing strings default to English in `src/shared/locales/en.ts`. A later `vi.ts` adds Vietnamese without changing components.
