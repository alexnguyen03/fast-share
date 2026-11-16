# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Users

Primary users are general consumers who want to move annotated images between a phone and a computer on the same Wi-Fi quickly, with the image ready to paste on the destination computer.

A secondary, documented workflow is a developer or QA tester working on a phone who needs a marked-up screenshot on the PC they are working at (from the repository README).

## Product Purpose

Fast Share sends marked-up phone images to a chosen computer on the same Wi-Fi and makes them ready to paste. The destination computer notifies the user, stores the files, and can place a single image on the clipboard.

## Positioning

Fast Share starts where LocalSend ends: the image is annotated on the phone, then ready to paste on the destination PC. There is no cloud relay and no account.

## Operating Context

- Uses the local Wi-Fi network; both devices are on the same LAN.
- On iOS the entry point is the Photos share sheet (a share extension); Android runs the same phone UI but does not yet register a share target.
- The computer app is the host: it receives images, keeps history for a configurable number of days, and can copy one image to the clipboard.
- Pairing is via scanning a QR code shown by the computer.

## Capabilities and Constraints

- Clients: Windows, macOS, Linux desktop host; iPhone; and the same phone UI on Android.
- Built with Tauri v2 (Rust backend) and a React 19 + TypeScript + Tailwind CSS v4 frontend running in a webview. The UI is web technology, not Flutter or React Native; the design language is intended to adapt per OS across the desktop host and the phone UI.
- No cloud relay, no account.
- MIT licensed.
- iOS share extension is Swift source under `share-extension/`.
- Android ships a signed sideload APK; the share-sheet target is not wired up yet.

## Brand Commitments

- Product name: Fast Share.
- Apple App Group: `group.com.alexnguyen03.fastshare`.
- No explicit brand voice, palette, or asset system is defined in the repository.

## Evidence on Hand

- `README.md`: product positioning, build/device instructions, and the testing workflow.
- `src/desktop/` (host: devices, history, settings), `src/phone/` (devices, editor, send, settings), `src/shared/` (commands, lib, locales, ui).
- `share-extension/`: iOS share extension Swift source.

## Product Principles

- Be fast and local: same-Wi-Fi transfer with no cloud and no account.
- Land ready to use: the image arrives annotated and paste-ready on the destination computer.
- Keep the surface small and predictable: desktop host and phone UI do one job well.
- Adapt to each platform's conventions rather than forcing one look everywhere.
