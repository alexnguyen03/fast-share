# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- Desktop: the window ignored clicks for seconds after opening, and switching to Images was slow. Every tile pulled its whole file through a synchronous command as base64 (one photo was 45 MB). Tiles now load small cached thumbnails from an `fsimg://` protocol, lazily and off the main thread; the preview shows the thumbnail first and the original once it has loaded.
- Desktop: a closed preview could not be opened again until restart. The close-to-tray rule hid every window, the preview included; now it applies to the main window only.
- Desktop: the full-screen image preview opened as a frozen white window. It was created from a synchronous command, which deadlocks on Windows; the command is async now, and Esc always closes the preview.

- iOS now vibrates after a toss: the capability named a haptics permission set the plugin does not define, so every haptic call was refused.
- iOS no longer zooms in when a field gets focus, and pinch zoom is off.

### Added

- Desktop: Devices and Settings live in the edge sidebar; the bottom bar switches between Images and Clipboard.
- Desktop: clipboard items show only the text; click copies, right-click has Preview (select part of it), Details, Save forever, Mask as sensitive, and Delete.
- Desktop: links with tokens, API keys and password-like text show with a masked middle (`https:/*****vCaD/`); copying still gives the full text.
- Desktop: Save forever for texts as well as images; saved items survive old-history cleanup and Delete all.
- Desktop: keys `i` `c` `s` `d` `h` `t`, Enter or Ctrl+C to copy, and Ctrl+Shift+Space anywhere to bring the app up or put it away.
- Desktop: image preview fills the screen, with icon buttons and the file size; deleting an image asks first.
- Phone: the header and tab bar stay put, a sideways swipe changes tab, and only the current tab shows its name.
- Phone: tossing asks which computers should catch it (tick one or more); with one paired computer it goes straight there. The image picker fills the top half of Send.
- Phone: pull down on Devices to refresh.
- Phone: Discard edits in the editor, a "?" with pairing help and network details, and the Wi-Fi name next to "On this Wi-Fi" (asks for location permission, which iOS and Android require for it).
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
