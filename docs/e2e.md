# End-to-end encryption and threat model

Status: **LAN channel and relay implemented (phone to PC), encryption at rest not yet.** `protocol.md` describes the shipped wire format. It needs an internal security review (see Review) before any release.

Goal: the same security model on the LAN and through a relay, so that no server, network, or Wi-Fi neighbour has to be trusted with user data. Images and text are exchanged between two devices that hold each other's public keys. A relay only moves ciphertext. Data stored on the desktop is encrypted at rest.

## Decisions

- Noise implementation: the Rust crate `snow`.
- Application message encoding: CBOR.
- LAN transport: the existing HTTPS server stays. The secure channel runs inside it (see Secure channel).
- Encryption at rest is required, not optional.
- Lost-phone revocation beyond "forget it on the desktop" is roadmap, not part of this version.

## Threat model

Assets: image bytes, text, device names, the list of paired devices.

Trusted: the two endpoints (phone app, desktop app) and the OS key storage on each.

Not trusted, and must not be able to read or alter content:
- the relay operator, or anyone who owns the relay machine
- anyone on the same Wi-Fi (passive or active, including a rogue mDNS responder)
- anyone on the path between a device and the relay
- a stranger who learns a mailbox id or a relay address
- someone who copies the desktop's data folder or disk without access to the logged-in OS account

Out of scope (stated so nobody assumes otherwise):
- a compromised phone or PC, or someone using an unlocked, logged-in PC (malware reading the clipboard, the app's memory, or the decrypted history)
- hiding metadata from the relay: it sees both IP addresses, message sizes, timing, and the mailbox id
- traffic analysis and denial of service (a relay can always drop traffic)
- content the user copies out of the app: a clipboard entry is plaintext for whatever else reads the clipboard

Pairing is the only moment trust is created. A wrong key accepted there defeats everything after it, so pairing is where this spec is strictest.

## Identity

Each device creates one long-term X25519 key pair on first run and never sends the private key anywhere.

- `deviceId` = the first 32 hex characters of `SHA-256(public key)`. The id is derived from the key, so a device cannot claim someone else's id.
- Private key storage: iOS Keychain; desktop OS credential store; on Android the private key is encrypted with an AES key held in the Android Keystore (Keystore does not hold X25519 on all supported versions) and the ciphertext lives in app-private storage. Losing the key means pairing again.
- The desktop keeps an allow-list of phone public keys. The phone keeps the desktop public key. Forgetting a device deletes that key. This replaces the per-phone `secret`.

## Secure channel

One Noise handshake, `Noise_XK_25519_ChaChaPoly_SHA256`, implemented with `snow`, runs over a reliable ordered byte stream.

- LAN: the stream is a WebSocket upgrade on the existing HTTPS port (self-signed certificate, as today). Relay: the same WebSocket framing on the relay's pipe. One framing for both paths. The certificate pin from `protocol.md` is kept as an extra layer on the LAN, but nothing in this spec relies on it: if TLS were stripped, content and authentication would still hold.
- The phone is the initiator and already knows the desktop's static key. The desktop learns the phone's static key inside the handshake and checks it against the allow-list. An unknown key is only accepted in a pairing flow (below).
- Prologue: the ASCII string `fast-share/2` plus the desktop `deviceId`. A client of another version fails the handshake instead of misparsing.
- After the handshake, every application message is one Noise transport message. Plaintext chunks are at most 65 000 bytes (Noise limit 65 535 minus the 16-byte tag). Large images are split into chunks and reassembled by sequence number.
- Application messages are CBOR values (an externally tagged enum, kebab-case names). Image bytes travel as CBOR byte strings, never base64. Types:
  - `begin-images { batchId, count }`, then per image `item { size }` and `chunk` messages, then `end`
  - `begin-text { batchId, size }`, then `chunk` messages with the UTF-8 bytes, then `end` (a text can be 1 MiB, more than one Noise message)
  - `ack` or `error { code }`; `paired` or `rejected` after a pairing request
  - the receiver ignores unknown map keys and rejects unknown `type` values
- Limits from `protocol.md` still apply, enforced by the receiver after decryption: at most 20 images, 20 MiB per image, 1 MiB text. The receiver discards a stream that exceeds them.
- `batchId` de-duplication is unchanged and happens after decryption. A retry through a relay therefore never stores twice.
- Replay: Noise nonces make each message single-use inside one session. Replaying a whole earlier session fails because the initiator's ephemeral key is fresh.

## Pairing

The desktop shows a one-time pairing offer. The phone then connects and the handshake must end with the desktop user accepting the phone's key.

### A. QR code

The QR carries: desktop static public key, `pcId`, a one-time `pairingToken` (16 random bytes, valid 10 minutes), and optionally a relay address.

- The QR is the out-of-band channel, so the phone knows the desktop key is authentic with no further check.
- The phone sends `pairingToken` as the first encrypted payload. The desktop accepts the key only if the token is valid and unused, then asks the user to accept, as it does today.

### B. Nearby device without QR ("Connect, other side confirms")

The desktop key arrives over mDNS, which anyone on the LAN can forge. Authentication therefore comes from a short authentication string (SAS).

- After the handshake both sides compute `SAS = 6 digits from SHA-256("fast-share-sas" || handshake hash)`. The handshake hash covers both static keys and both ephemerals.
- Both screens show the SAS. The desktop pairs the phone only after the user confirms the numbers match. If they do not match, the session is dropped and the key is never stored.
- Six digits give an attacker a one in a million chance per live attempt, and each attempt is visible to the user. Four digits (the earlier plan) are too few for something that can be retried.
- Limits: at most 5 pending requests, 2-minute expiry, per-IP rate limit.

### C. Through a relay

A or B work unchanged, because the relay is only the byte pipe under the handshake. A relay address in a QR is part of the authentic offer. A relay address entered by hand is fine for A. For B, the SAS comparison is required.

### Typed 6-digit code (existing `/pair/code`)

Not carried over. A typed code used as a Noise pre-shared key can be guessed offline by anyone who recorded the handshake. B replaces it. A password-authenticated key exchange (for example CPace) could bring typed codes back later.

## Relay

A relay has no account system, no database, and no disk storage of payloads.

- The desktop opens an outbound WebSocket to `/m/{mailbox}` and stays connected. `mailbox` = base32 of `SHA-256("fast-share-mailbox" || desktop public key)`.
- The phone connects to the same path as a second stream. The relay pipes bytes between the two, in memory, with backpressure. If no desktop is connected it answers 409 at once. Nothing is queued.
- The relay never parses payloads. It sees ciphertext and the metadata listed in the threat model.
- Relay access control is separate from data protection and is the operator's choice: a shared token set in the relay's environment (`RELAY_TOKEN`), sent in the `Authorization` header, so strangers cannot use someone else's server. A mailbox id is not a secret. A stranger who knows it can connect, but the handshake fails for anyone without an allow-listed key.
- A hostile relay can drop, delay, or replay traffic. It cannot read or change content, because a changed message fails Noise authentication. It can tell that a pair of devices talks to each other.
- The relay's own TLS only protects metadata on the wire, and for a self-hosted relay without a domain the client may pin the relay's certificate fingerprint. Content security does not depend on it.

## Encryption at rest (desktop)

Everything the desktop stores about received content is encrypted: `history.json`, every image file, and the allow-list of phone keys.

- One random 256-bit data key per installation, stored in the OS credential store (Windows Credential Manager/DPAPI, macOS Keychain, Linux Secret Service). The key never lies in the data folder.
- Cipher: XChaCha20-Poly1305, a fresh random 24-byte nonce per file write, the file's name as associated data so files cannot be swapped. A modified file fails to decrypt and is reported, not skipped silently.
- Images are written as `image-{imageId}.png.enc`. The decrypted bytes exist only in memory while the app copies them to the clipboard or shows them. Thumbnails and previews are not cached on disk in plaintext.
- Existing plaintext data is migrated on first start of the new version: encrypt each file, verify it decrypts, then delete the plaintext original. The migration is resumable and does not delete anything it has not verified.
- Protects against a copied or stolen disk, a backup, or another OS account. It does not protect against code running as the logged-in user (see threat model).
- If the credential store is missing (some Linux setups), the app falls back to a key file in the app data directory with owner-only permissions, so the app keeps working without extra setup. Known limit: that file sits next to the encrypted data, so a copied data folder is no longer protected on those machines. The app shows a notice when it uses the fallback. Upgrade path: require the credential store or a user passphrase (see Known limits).
- The phone does not keep received content. Its only secret is its own private key, protected as in Identity.

## What this replaces

| Today | Target |
| --- | --- |
| `deviceId` + `secret` in the JSON body | key-derived `deviceId`, Noise static key, allow-list |
| phone pins the desktop certificate SHA-256 | phone pins the desktop X25519 key (certificate pin kept as an extra layer) |
| `/pair`, `/pair/code`, `/pair/status`, `/batches`, `/texts` as JSON over HTTPS | one Noise stream (WebSocket on the HTTPS port) carrying CBOR messages |
| LAN only | LAN and relay, same channel |
| plaintext `history.json` and PNG files | encrypted at rest |

The current endpoints stay until both apps speak the new channel, then they are removed. There is no long-term fallback to the old protocol, because a fallback would let an attacker downgrade it.

## Review

An internal security review is a release gate. Before any version ships with this protocol, someone other than the author reads the code against this document and signs off on a checklist:
- pairing A and B: no path stores a key without the token or the user's confirmation
- the SAS is computed from the final handshake hash and shown only after the handshake completes
- every receiver limit is enforced after decryption
- the private key, the data key, and decrypted content never reach logs, crash reports, or notifications
- the relay holds no payload on disk and logs no content
- the at-rest migration never deletes an unverified file

An external review is wanted before the project is promoted to companies. It is not decided or scheduled, and it is not a gate for this version.

## Known limits

Ease of use comes first in this version. These are accepted gaps, each with the point where it should be tightened:

- **Private key storage:** the device key (`keys.json`) is a file in the app data directory, not wrapped by Android Keystore or iOS Keychain yet. Tighten before a public release.
- **Relay token in the QR:** the QR carries the relay token, so a photographed QR gives relay access (not data access). Per-device relay tokens would close this.
- **Linux without a credential store:** the data key is a file next to the data (see Encryption at rest). Tighten by requiring the credential store or a passphrase before promoting the app to companies.
- **Key backup:** losing a device key means pairing again; there is no recovery. Fine while the user base is small.
- **Relay metadata:** a relay operator sees who talks to whom, when, and how much (see Threat model).
- **No external review yet** (see Review).

## Roadmap (not in this version)

- Lost phone: today "forget" on the desktop revokes it. A faster flow (remote revoke, notice on other devices) comes later.
- Typed pairing code through a PAKE such as CPace.
- Desktop to phone direction.
- Hiding metadata from the relay.

## Open items

- Implemented as: `snow` with `default-features = false` and `default-resolver`, `use-chacha20poly1305`, `use-sha2`, `use-curve25519`, `use-getrandom`, and without `std` (that feature pulls in `ring`; the app already links `ring` through rustls, so this only keeps `snow` itself free of C). The handshake and a 150 kB two-image batch run over a real pinned TLS WebSocket in the `runtime` tests on Windows. Android and iOS builds, and a run on a real phone, are still to be checked.
