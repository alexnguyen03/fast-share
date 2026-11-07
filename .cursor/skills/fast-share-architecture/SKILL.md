---
name: fast-share-architecture
description: Fast Share module boundaries and product invariants. Use before any feature, protocol change, folder addition, or review of this repository.
---

# Fast Share architecture

Read this before changing the app. The wire format lives in `docs/protocol.md`. Update that document before changing pairing or image upload.

## Dependency direction

UI calls a Tauri command. The command calls one use case. The use case calls ports. Ports do not import UI.

```text
src (phone, desktop)
  -> commands
    -> use_cases
      -> ports
        -> adapters (OS)
```

## Folders

- `src/phone` is the editor, destination picker, and pairing screen. Pairing opens the device camera through the barcode-scanner plugin. The webview does not decode QR codes.
- `src/desktop` is history, trusted phones, and settings.
- `src/shared` holds command types, settings types, and `locales/en.ts`.
- `src-tauri/src/domain` holds ids, device state, validated images, and settings.
- `src-tauri/src/use_cases` holds one module per job: accept a device, ingest a batch, copy an image, purge history, update settings.
- `src-tauri/src/ports` holds traits for the clipboard, notifier, clock, and file store.
- `src-tauri/src/adapters` holds the operating system implementations, the pinned phone client, mDNS, and the share-extension inbox.
- `src-tauri/src/runtime.rs` is the composition root: it owns the store, the pairing ticket, and the LAN server. Commands lock that state and call use cases.
- `share-extension/` is the Swift source. It copies images into the App Group and opens the app. It does not draw and it does not open a socket. `src-tauri/gen` is generated. Do not treat it as the source.

## Invariants

- One send targets one computer.
- An untrusted phone cannot store images.
- Upload bytes become a domain image only after the size check and a successful decode.
- Stored names are assigned by the computer.
- A one-image batch is copied to the clipboard. A multi-image batch is not.
- History retention comes from settings. The default is 7 days, the range is 1 to 90, and lowering it purges immediately.
- There is no internet relay and no account.
- English is the default UI locale. Add `vi.ts` later instead of hard-coding a second language in components.

## Patterns that belong here

Use a newtype for `DeviceId`, `PcId`, and `BatchId`. Model device trust as an enum: unknown, pending acceptance, trusted, forgotten.

Editor tools are the union `Crop | Arrow | Text | Blur`. A new tool is a new variant, not an edit to the canvas core.

Rust host errors return `Result`. Do not `unwrap` on the receive path. Do not use `unsafe` without a safety comment.

Do not add a repository layer, a unit of work, an abstract factory, or extra clean-architecture tiers. History is a local file store.
