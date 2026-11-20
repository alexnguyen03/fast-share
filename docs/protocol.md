# Protocol

Fast Share moves images from a phone to one computer on the same Wi-Fi. The computer is the host. The phone never opens a public relay.

Identifiers are stable ids, not IP addresses. `DeviceId`, `PcId`, and `BatchId` are distinct types.

## Identity and trust

Each device has one long-term X25519 key pair (see `e2e.md`). A device id is derived from its public key, so it cannot be claimed without the key. The computer keeps the public keys of the phones the user accepted. The phone keeps the public key of each computer it paired with. Forgetting a device deletes that key. The old per-phone secret does not exist any more.

## Transport

The computer listens on HTTPS (a self-signed certificate) on a private RFC1918 LAN IPv4 address, ignoring VPN, virtual, and link-local adapters, and advertises `_fastshare._tcp.local.` with TXT `id`, `name`, `fp` (certificate SHA-256) and `pk` (public key, standard base64). Mobile clients never start the listener or advertise mDNS. When the phone resolves a remembered `pcId` on the LAN it updates that computer's remembered host and port before checking readiness or sending.

- `GET /ready` answers `{ "ok": true }` so a remembered phone can see that the app is open.
- `GET /v2/identity` answers `{ pcId, name, pubKey, fingerprint }`. It is unauthenticated: it only lets a phone start pairing by typed address, and the pairing code is what makes that safe.
- `GET /v2/channel` upgrades to a WebSocket. Everything else travels inside it as encrypted frames. The phone also pins the certificate fingerprint as an extra layer; nothing depends on it.

On the channel the phone runs a Noise `XK` handshake (`Noise_XK_25519_ChaChaPoly_SHA256`, prologue `fast-share/2` plus the computer's device id) with the computer's public key it already holds. Its first encrypted payload is a CBOR `Hello { pairingToken?, pair, name }`. After that each WebSocket binary frame is one Noise transport message carrying one CBOR `Msg` (at most 65 519 bytes of plaintext; blobs are split into chunks of 60 000 bytes). The full design and threat model are in `e2e.md`.

## Pairing

The computer must accept a phone before any content is stored. A phone whose key is not on the computer's list can ask to pair (`Hello.pair = true`); a plain send from an unknown key is refused at once with `not-trusted`.

**A. QR code.** The computer shows a QR code with JSON version 2: `pcId`, `name`, `host` and `port` (a private IPv4 address on the LAN; loopback only on the same machine), `token` (one-time, expires 10 minutes after it is issued), `fingerprint` (certificate pin), `pubKey` (the computer's public key) and `expiresAt`. The phone rejects the payload when the host is not a LAN address, the key is not 32 bytes, or it is expired. The phone sends the token in `Hello`; a wrong, used or expired token is refused. The computer then asks the user to accept.

**B. Nearby, no QR.** The phone takes the computer's key from mDNS (or from `/v2/identity` for a typed address). Because that key is not authenticated, both screens show a six-digit code computed from the handshake hash, and the user accepts on the computer only if the codes match. A mismatch means someone is in the middle: the user rejects and nothing is stored.

In both cases the computer sends `paired` or `rejected` over the same open channel; the phone waits up to two minutes. Requests that are not answered in two minutes are dropped. At most 5 requests wait at once, and one address may start at most 10 pairing attempts a minute.

The desktop Devices screen and the phone Devices screen both show this device's IPv4 address, `/24` subnet, and usable interface list so a subnet mismatch is visible before pairing. When a connection fails, the phone reports the specific cause:
- Different subnet / double NAT when the phone IPv4 and computer IPv4 are on different `/24` networks. The error names both addresses. Cellular / `rmnet` interfaces are ignored when choosing the phone's LAN IP.
- No server at the advertised `IP:port` when the connection is refused or reset, which means the desktop app is closed, asleep, or showing a different `IP:port` under the QR code.
- Guest Wi-Fi / AP isolation or Windows Firewall when both devices are on the same subnet (`192.168.1.x`) but the connection times out.
- Filtered multicast (IGMP snooping) when mDNS returns no hosts on Wi-Fi, prompting the user to enter the `IP:port` shown under the QR code.
- On Windows, if the active network profile is `Public` and no inbound firewall rule exists for Fast Share, the desktop UI warns the user and offers a one-click action to add the firewall rule.

Forgetting a device removes trust; the next visit needs a new pairing. One send has one destination computer. Switching destination does not move images already stored on the previous computer.

## Send a batch

The phone shares one or more images from Photos, edits them, then sends the edited bytes over the channel: `begin-images { batchId, count }`, then for each image `item { size }` and its `chunk` messages, then `end`. The computer answers `ack` or `error { code }`.

The computer checks that the sender's key is trusted and the image count (1 through 20) before reading the bytes. It accepts the batch only when every image is at most 20 MiB, the batch is at most 100 MiB, neither dimension exceeds 8192, and every image decodes. All limits are enforced after decryption. A repeated `batchId` from the same device is a no-op that is acknowledged without storing duplicates, overwriting the clipboard, or sending another notification. For a new batch it validates the whole batch before writing any file, re-encodes each image as PNG, and names the file `image-{imageId}.png`.

## Send text

The phone can also send plain text (for example the clipboard): `begin-text { batchId, size }`, then `chunk` messages, then `end`. The computer requires `text` to be UTF-8, contain something other than whitespace and no NUL character, and be at most 1 MiB. A repeated `batchId` is a no-op. A new text is stored in the history (inline in `history.json`, as `texts` on the batch), copied to the computer clipboard when `autoCopyToClipboard` is on, and announced with a notification. Failing to write the clipboard never loses the text. Text is not pinnable and expires with the retention window like images.

Error codes: `not-trusted`, `expired`, `busy`, `too-large`, `invalid`, `internal`.

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

`pcDisplayName` defaults to `My PC`. Boolean settings include `autoStartWithOs` (default `false`), `closeToTray` (default `true`), and `autoCopyToClipboard` (default `true`). A patch may send any subset of these fields. Unknown keys are rejected. Loading an older file still fills missing fields from the defaults and ignores keys this version does not know.

## UI copy

User-facing strings default to English in `src/shared/locales/en.ts`. A later `vi.ts` adds Vietnamese without changing components.
