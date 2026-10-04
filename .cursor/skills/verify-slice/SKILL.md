---
name: verify-slice
description: Check a Fast Share change before calling it done. Use at the end of a slice that touches the host, the UI, pairing, or image files.
---

# Verify a slice

Run this before treating a change as finished. Skip a command only when that project directory does not exist yet, and say which check you skipped.

## Commands

From the repository root, once the Tauri app exists:

- `cargo test --manifest-path src-tauri/Cargo.toml` when `src-tauri` changed
- the TypeScript typecheck script in `package.json` when `src` changed

## Review

- Host changes match `.cursor/rules/rust-host.mdc`.
- UI changes match `.cursor/rules/typescript-ui.mdc`.
- Pairing, upload, files, clipboard, or history changes match `.cursor/skills/host-security/SKILL.md`.
- If the wire format changed, `docs/protocol.md` changed in the same slice.
- New user-facing copy is in `src/shared/locales/en.ts`, not hard-coded in a component.

## Done means

Tests that apply to the slice passed, the typecheck passed, and the architecture skill still describes the folders you touched.
