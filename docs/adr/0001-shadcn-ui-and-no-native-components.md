# ADR-0001: Use Tailwind CSS and shadcn/ui; Prohibit Unapproved Native UI Components

- **Status:** Accepted
- **Date:** 2026-11-06
- **Scope:** `src/desktop`, `src/phone`, `src/shared/ui`

## Context

Fast Share runs across desktop (Windows, macOS, Linux) and mobile (iOS, Android) WebViews inside Tauri.
Previously, screens constructed raw DOM elements (`<button>`, `<input>`, `<select>`) and invoked browser-native blocking dialogs (`window.confirm`, `window.alert`, `window.prompt`).

Using raw native controls and OS/WebView dialogs caused several issues:

1. **Inconsistent appearance across WebViews:** Native `<select>` dropdowns, `<button>` focus rings, and `window.confirm` dialogs render differently on WebView2 (Windows), WKWebView (iOS/macOS), and Android WebView, breaking the custom frameless window aesthetic.
2. **Event loop & focus issues in frameless windows:** Blocking browser dialogs (`window.confirm`, `window.alert`) freeze the WebView thread and can cause focus loss or visual glitches in transparent, always-on-top, or tray-anchored Tauri windows.
3. **Duplicated styling:** Ad-hoc CSS rules for buttons, inputs, cards, badges, and dialogs drifted between `src/desktop` and `src/phone`.

## Decision

1. **Adopt Tailwind CSS (`@tailwindcss/vite`) and `shadcn/ui` primitives (`src/shared/ui/*`):**
   - All reusable UI primitives (`Button`, `Input`, `Label`, `Card`, `Badge`, `Select`, `AlertDialog`, `Checkbox`, etc.) live in `src/shared/ui/` and are built on Radix UI primitives + Tailwind CSS (`class-variance-authority`, `clsx`, `tailwind-merge`).
2. **Prohibit unapproved native UI components in feature code (`src/desktop/**` and `src/phone/**`):**
   - Feature components **MUST NOT** directly render raw interactive native form/control elements:
     - `<button>` -> use `Button` from `@/shared/ui/button`
     - `<input>` -> use `Input` from `@/shared/ui/input` or `Checkbox` from `@/shared/ui/checkbox`
     - `<select>` / `<option>` -> use `Select`, `SelectTrigger`, `SelectContent`, `SelectItem` from `@/shared/ui/select`
     - `<textarea>` -> use a `shadcn/ui` `Textarea` primitive in `src/shared/ui/`
   - Feature code **MUST NOT** call blocking native browser dialogs:
     - `window.confirm`, `window.alert`, `window.prompt` -> use `AlertDialog` from `@/shared/ui/alert-dialog`
3. **Exception process:**
   - Low-level non-control primitives that have no `shadcn/ui` equivalent (such as `<canvas>` for the image annotation stage) are permitted when required by the feature, or when explicitly approved by the user.
   - Any new primitive wrapper around a native HTML control must be defined once inside `src/shared/ui/` following `shadcn/ui` conventions, never inline in `src/desktop` or `src/phone`.

## Consequences

- **Positive:** Uniform styling, keyboard accessibility, and predictable behavior across Windows, macOS, Linux, iOS, and Android WebViews; no blocking native popups; single source of truth for UI primitives in `src/shared/ui/`.
- **Negative:** Slight increase in frontend bundle size from React + Radix UI primitives (~50 KB gzipped), which is negligible for a local Tauri bundle.
