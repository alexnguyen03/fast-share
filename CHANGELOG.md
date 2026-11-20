# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Repository documents, contributor templates, and the local pairing protocol notes.
- Tauri host that pairs a phone, stores validated images, notifies, and purges history from settings.
- Phone UI for one destination, crop, arrow, text, and blur, plus the desktop history panel.
- iOS share extension sources and the script that reattaches them after `tauri ios init`.
- GitHub Actions builds a portable Windows executable, an unsigned iOS app for sideload testing, and an Ad Hoc iOS app once signing secrets are set.
- The phone scans a pairing QR in a square, and shows each pairing step on screen.
- The desktop tray opens the window on click and can exit while it is in the background.
- Desktop history is a small floating panel.

### Added

- `npm run android:apk` now stamps the build with the git hash and the build time: the APK is copied to `dist-apk/` with both in its name, and Settings shows them under Build.
- A self-hosted relay (`relay/`, see `docs/relay.md`) so a phone can reach its computer outside the Wi-Fi without trusting the relay. Settings → Relay on the computer, and the pairing QR carries the relay.

### Changed

- Phone to computer sends now use an end-to-end encrypted channel (Noise) tied to each device's own key. Existing pairings stop working: pair again. The typed 6-digit code is replaced by "Connect" on a nearby computer, with a code to compare on both screens. See `docs/e2e.md`.
