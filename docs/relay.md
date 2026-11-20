# Relay

A relay lets a phone reach its computer when they are **not** on the same Wi-Fi. You host it yourself. It sits between the two and passes encrypted frames along. It cannot read them: every message is encrypted end to end between the phone and the computer (see `e2e.md`), and the relay holds nothing on disk and queues nothing. If the computer is not connected to it, a phone gets an error at once.

You do not need a relay on the same Wi-Fi. Phones use the Wi-Fi when the computer answers there and fall back to the relay only when it does not.

## Run it

You need a machine the phones can reach (a public IP or a name is enough; no domain is required).

```
cd relay
cargo run --release -- --public-host 203.0.113.9
```

On the first start it makes a self-signed certificate and an access token in `./relay-data`, and prints one line to paste into Fast Share:

```
fastshare-relay://203.0.113.9:8443?fp=<certificate sha256>&token=<access token>
```

In Fast Share on the computer open **Settings → Relay**, paste the line, and save. The status shows **Connected** when the computer has reached the relay. Pair a phone by scanning the QR code shown after that: the QR now also carries the relay, so the phone can pair from anywhere. A phone that paired earlier on the Wi-Fi learns the relay automatically on its next pairing.

### Install a release on a Linux server

Tags named `relay-v*` publish ready-made binaries (x86_64 and aarch64, glibc 2.35 or newer) as a GitHub release. The script downloads the right one, checks its SHA-256, and installs it:

```
curl -fsSL https://raw.githubusercontent.com/alexnguyen03/fast-share/main/scripts/install-relay.sh \
  | sudo sh -s -- --service --public-host 203.0.113.9
```

`--service` also creates a systemd service (`fast-share-relay`, runs as a throwaway user, data in `/var/lib/fast-share-relay`) and prints the line to paste. Without it the binary is only installed (`/usr/local/bin` as root, `~/.local/bin` otherwise). Other options: `--version`, `--dir`, `--port`, `--dry-run`. A company that mirrors the releases can point the script at its mirror with `RELAY_DOWNLOAD_BASE`. Open the TCP port (8443 by default) in the server's firewall.

To read the script before running it, download it, open it, then run `sudo sh install-relay.sh …`.

### Docker

```
docker build -t fast-share-relay relay
docker run -d --name fast-share-relay -p 8443:8443 -v relay-data:/data fast-share-relay --public-host 203.0.113.9
docker logs fast-share-relay   # shows the line to paste
```

### Options

| Option | Meaning |
| --- | --- |
| `--listen ADDR` | where to listen (default `0.0.0.0:8443`) |
| `--public-host HOST` | name or IP phones use; only used in the printed line |
| `--token TOKEN` or `RELAY_TOKEN` | the access token. Without one, a token is made once and kept in the data directory |
| `--allow-open` | no token at all. Anyone who can reach the address can use the relay |
| `--plain` | serve `ws://` for use behind a proxy that does TLS |
| `--data-dir DIR` | certificate and token (default `./relay-data`) |
| `--connects-per-minute N` | phone connects per address per minute (default 60) |

### Behind a proxy with a real certificate

Run the relay with `--plain` and let the proxy terminate TLS and pass WebSocket upgrades through. Use the proxy's `wss://` address in the relay line without `fp`:

```
fastshare-relay://relay.example.com:443?token=<access token>
```

Every phone then seems to come from the proxy's address, so raise `--connects-per-minute` or rate limit at the proxy.

## What the operator can and cannot see

Cannot: images, text, device names, the keys, anything inside a message.

Can: both IP addresses of every connection, when it happens, how much data moves, and the mailbox id (a hash of the computer's public key, so it tells which computer is being reached but not who owns it).

## Limits

- Access control is one shared token. The QR code a computer shows carries it, so anyone who photographs that QR can use the relay (not read anyone's data). Per-device tokens would close this.
- One relay process, nothing persisted: a restart drops running transfers and computers reconnect on their own.
- Per mailbox at most 8 sessions at once, frames up to 65 535 bytes, a session idles out after 5 minutes and ends after 30.
- The relay is a single point of failure for off-Wi-Fi use. On the Wi-Fi the apps do not need it.
