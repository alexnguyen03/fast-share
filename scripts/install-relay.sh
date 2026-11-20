#!/bin/sh
# Downloads the Fast Share relay for this machine from GitHub releases, checks its checksum,
# and installs it. With --service on Linux it also sets it up as a systemd service.
#
#   curl -fsSL https://raw.githubusercontent.com/alexnguyen03/fast-share/main/scripts/install-relay.sh \
#     | sudo sh -s -- --service --public-host 203.0.113.9
#
set -eu

REPO="${RELAY_REPO:-alexnguyen03/fast-share}"
VERSION=""
DIR=""
SERVICE=0
PUBLIC_HOST=""
PORT=8443
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: install-relay.sh [options]
  --version V         release to install, e.g. 0.1.0 (default: the newest relay release)
  --dir DIR           where to put the binary (default /usr/local/bin as root, else ~/.local/bin)
  --service           also install and start a systemd service (needs root)
  --public-host HOST  name or IP phones use to reach this server (used with --service)
  --port PORT         port the relay listens on (default 8443, used with --service)
  --dry-run           print what would be downloaded and stop
  -h, --help          show this help
EOF
}

die() { echo "install-relay: $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --version) [ $# -ge 2 ] || die "--version needs a value"; VERSION="$2"; shift 2 ;;
    --dir) [ $# -ge 2 ] || die "--dir needs a value"; DIR="$2"; shift 2 ;;
    --service) SERVICE=1; shift ;;
    --public-host) [ $# -ge 2 ] || die "--public-host needs a value"; PUBLIC_HOST="$2"; shift 2 ;;
    --port) [ $# -ge 2 ] || die "--port needs a value"; PORT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; die "unknown option $1" ;;
  esac
done

# RELAY_OS / RELAY_ARCH exist so the choice below can be tested on another machine.
os="${RELAY_OS:-$(uname -s)}"
[ "$os" = Linux ] || die "only Linux servers are supported (this is $os)"
case "${RELAY_ARCH:-$(uname -m)}" in
  x86_64|amd64) asset=linux-x86_64 ;;
  aarch64|arm64) asset=linux-aarch64 ;;
  *) die "unsupported CPU: ${RELAY_ARCH:-$(uname -m)}" ;;
esac

fetch() { # fetch URL [OUTPUT]; prints to stdout without OUTPUT
  if command -v curl >/dev/null 2>&1; then
    if [ $# -ge 2 ]; then curl -fsSL -o "$2" "$1"; else curl -fsSL "$1"; fi
  elif command -v wget >/dev/null 2>&1; then
    if [ $# -ge 2 ]; then wget -q -O "$2" "$1"; else wget -q -O - "$1"; fi
  else
    die "need curl or wget"
  fi
}

if [ -z "$VERSION" ]; then
  # The repository also has app releases, so pick the newest tag that starts with relay-v.
  VERSION=$(fetch "https://api.github.com/repos/$REPO/releases?per_page=50" \
    | grep -o '"tag_name": *"relay-v[0-9][^"]*"' | head -n 1 | sed 's/.*relay-v//; s/"$//') || true
  [ -n "$VERSION" ] || die "no relay release found in $REPO; pass --version"
fi
VERSION="${VERSION#relay-v}"
name="fast-share-relay-$VERSION-$asset"
# RELAY_DOWNLOAD_BASE lets a company mirror the releases internally.
base="${RELAY_DOWNLOAD_BASE:-https://github.com/$REPO/releases/download}/relay-v$VERSION"

if [ "$DRY_RUN" = 1 ]; then
  echo "would download $base/$name.tar.gz"
  exit 0
fi

if [ -z "$DIR" ]; then
  if [ "$(id -u)" = 0 ]; then DIR=/usr/local/bin; else DIR="$HOME/.local/bin"; fi
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "Downloading $name ..."
fetch "$base/$name.tar.gz" "$tmp/$name.tar.gz" || die "download failed: $base/$name.tar.gz"
fetch "$base/$name.tar.gz.sha256" "$tmp/$name.tar.gz.sha256" || die "checksum download failed"

echo "Checking the checksum ..."
if command -v sha256sum >/dev/null 2>&1; then
  (cd "$tmp" && sha256sum -c "$name.tar.gz.sha256" >/dev/null) || die "checksum does not match, not installing"
elif command -v shasum >/dev/null 2>&1; then
  (cd "$tmp" && shasum -a 256 -c "$name.tar.gz.sha256" >/dev/null) || die "checksum does not match, not installing"
else
  die "need sha256sum or shasum to check the download"
fi

tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
mkdir -p "$DIR"
install -m 0755 "$tmp/$name/fast-share-relay" "$DIR/fast-share-relay"
echo "Installed $DIR/fast-share-relay"

if [ "$SERVICE" = 1 ]; then
  [ "$(id -u)" = 0 ] || die "--service needs root (try sudo)"
  command -v systemctl >/dev/null 2>&1 || die "--service needs systemd"
  host="${PUBLIC_HOST:-YOUR-HOST}"
  cat > /etc/systemd/system/fast-share-relay.service <<EOF
[Unit]
Description=Fast Share relay
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=$DIR/fast-share-relay --listen 0.0.0.0:$PORT --public-host $host --data-dir /var/lib/fast-share-relay
DynamicUser=yes
StateDirectory=fast-share-relay
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now fast-share-relay
  echo
  echo "The relay is running. Paste this line into Fast Share on the computer:"
  sleep 1
  journalctl -u fast-share-relay -n 20 --no-pager | grep 'fastshare-relay://' | tail -n 1 || true
  [ -n "$PUBLIC_HOST" ] || echo "(replace YOUR-HOST with the name or IP phones use to reach this server)"
  echo "Open TCP port $PORT in your firewall if the server has one."
else
  echo
  echo "Run it with:  $DIR/fast-share-relay --public-host YOUR-HOST"
  echo "It prints the line to paste into Fast Share on the computer."
fi
