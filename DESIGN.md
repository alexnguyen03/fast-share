---
name: Fast Share
description: Send marked-up phone images to a computer on the same Wi-Fi and paste them.
colors:
  meadow-green: "#0f8a4b"
  cloud-white: "#fbfdf8"
  ink: "#161a1d"
  card-white: "#ffffff"
  sage: "#e7ece4"
  mist: "#f0f3ee"
  slate: "#5c666e"
  mint-tint: "#dff2e7"
  error-red: "#e23d3d"
  success-green: "#3dd68c"
  info-blue: "#6ea8fe"
  hairline: "#cfd6cc"
  field: "#b8c2c9"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 650
    lineHeight: 1
  title:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
  body:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  label:
    fontFamily: "system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "999px"
spacing:
  xs: "6px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  button-primary:
    backgroundColor: "{colors.meadow-green}"
    textColor: "#ffffff"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "{colors.sage}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.mist}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
    height: "40px"
---

# Design System: Fast Share

## Overview

**Creative North Star: "The Quiet Conduit"**

Fast Share's interface recedes so the transfer can happen. It is a quiet, tidy, single-purpose surface: neutral backgrounds, one accent, compact type, and controls that read as tools rather than decoration. The personality is "yên tĩnh và gọn gàng" — quiet and tidy — with nothing on screen that does not serve the job of getting an annotated image from a phone onto a computer.

The system is built on a shadcn/ui "new-york" foundation: semantic CSS custom properties (`--background`, `--primary`, `--muted`, `--radius`, and so on) drive six interchangeable themes, with `emerald-light` as the default. The desktop host and the phone UI share this one web-tech design system (React + Tailwind in a Tauri webview). The phone editor currently hard-codes its own dark palette; the confirmed direction is to fold it back into the theme tokens so every surface follows the same system.

**Key Characteristics:**

- Neutral, low-contrast surfaces with a single green accent.
- Compact, narrow single-column layout (max 440px) on both desktop and phone.
- Soft but restrained corners: 10px for cards/inputs, full pills for compact controls.
- Flat tonal layering — depth comes from surface color, not shadows.
- System-native typography with no display flourishes.

## Colors

The palette is deliberately restrained: near-white neutrals with a cool green tint, one Meadow Green accent, and semantic red/green/blue tokens for errors, presence (online), and annotation markers. Colors always come from theme tokens, never hard-coded component hex values.

### Primary

- **Meadow Green** (#0f8a4b): The single accent. Used for primary buttons, links, the focus ring, active accents, and the QR scan frame. Its rarity is the point — it marks the one thing the user should notice.

### Neutral

- **Cloud White** (#fbfdf8): App background; a near-white with a faint green undertone.
- **Card White** (#ffffff): Cards and raised content surfaces on the default light theme.
- **Ink** (#161a1d): Primary text; near-black with a cool cast.
- **Sage** (#e7ece4): Secondary fills — secondary buttons and selected states.
- **Mist** (#f0f3ee): Muted fills — inputs and card backgrounds at rest.
- **Slate** (#5c666e): Muted/secondary text.
- **Mint Tint** (#dff2e7): Accent wash; a pale green for tinted surfaces and accent foregrounds.
- **Hairline** (#cfd6cc): Borders and dividers.
- **Field** (#b8c2c9): Input borders and placeholder surfaces.
- **Error Red** (#e23d3d): Destructive actions and error states only.

### Named Rules

**The Theme Tokens Rule.** Components read color from CSS custom properties (`var(--background)`, `var(--primary)`, `var(--muted)`), never from a literal hex. Five additional themes — `solarized-light`, `catppuccin-latte`, `solarized-dark`, `tokyo-night`, and `catppuccin-mocha` — swap the same semantic slots under `[data-theme="…"]`. A new surface must keep working across all six.

**The One Accent Rule.** A single accent (per theme) carries all interactive emphasis. Do not introduce a second accent color to "add interest"; use neutrals and the accent wash instead.

## Typography

**Display Font:** system-ui (with -apple-system, sans-serif fallback)
**Body Font:** system-ui (with -apple-system, sans-serif fallback)
**Label/Mono Font:** ui-monospace, monospace (logs and code only)

**Character:** Native and neutral. The system font stack keeps the app feeling like part of the OS rather than a branded document; type is sized for utility, not spectacle.

### Hierarchy

- **Headline** (650, 1.125rem / 18px, 1.0): Page and screen titles. Compact on purpose.
- **Title** (600, 1rem / 16px): Emphasis inside buttons, sections, and large controls.
- **Body** (400, 0.875rem / 14px, 1.43): Default text. Keep lines short inside the narrow panel.
- **Label** (600, 0.75rem / 12px): Badges, captions, and small status text.

## Layout

A single narrow column centers all content: `.panel` caps at **440px** with **16px** padding and a **12px** vertical rhythm (smaller gaps of **8px** and **6px** for tight clusters). The desktop host renders in a frameless, transparent window and reuses the same panel; the phone UI adds safe-area top/bottom padding. Density is compact — controls sit at 36–48px tall, never sprawling.

## Elevation & Depth

This system is **flat by default**. There is no shadow vocabulary in the tokens; depth is conveyed entirely through tonal layering — background (Cloud White), cards (Card White), muted fills (Mist), and secondary fills (Sage) distinguish surfaces by value, not elevation. The one deliberate shadow is the phone camera scan hole's dark vignette (`0 0 0 100vmax rgba(0,0,0,0.72)`), a functional occlusion rather than a material lift.

### Named Rules

**The Flat-By-Default Rule.** Surfaces stay flat at rest. Do not add box-shadows to lift cards or buttons; separate layers with background/muted/sage values instead.

## Shapes

The form language is soft but restrained. Two radius families do all the work: the **10px family** (`--radius: 0.625rem`, with sm 6px / md 8px / lg 10px / xl 14px) for cards, inputs, and default buttons, and the **full pill (999px)** for compact controls — badges, icon buttons, the phone editor's tool dock, and destination/send pills. Corners are rounded enough to feel friendly, never enough to feel decorative.

## Components

### Buttons

- **Shape:** Default buttons are 10px radius (`rounded-lg`); the large size and pill controls are fully rounded (`999px`).
- **Primary:** Meadow Green fill, white text, 36px tall (`h-9`, padding 8px 16px). Hover is a slight opacity drop (92%).
- **Secondary / Outline:** Sage or translucent Sage fill with Ink text; outline uses a Sage background at 75% opacity.
- **Focus:** A 2px ring in the accent at ~30% opacity, no default outline.
- **Feel:** Refined and restrained — tactile enough to confirm a tap, quiet enough not to shout. High-emphasis send actions use the primary accent.

### Cards / Containers

- **Corner Style:** 14px radius (`rounded-xl`).
- **Background:** Muted (Mist) fill, borderless, with Ink text.
- **Shadow Strategy:** None — see the Flat-By-Default Rule.
- **Internal Padding:** 16px (`p-4`) header/content.

### Inputs / Fields

- **Style:** 40px tall (`h-10`), 10px radius, Mist fill, no border, 14px Ink text.
- **Focus:** Background shifts to Sage with a 2px accent ring at ~30% opacity.
- **Disabled:** 50% opacity, pointer disabled.

### Badges

- **Style:** Full pill, 12px semibold text, tight 8px × 2px padding.
- **Variants:** Default (Meadow Green fill, white text), Secondary (Sage), Destructive (Error Red), Outline (hairline border).

### Navigation & Pills

- **Style:** Destination/send pills are fully rounded (999px), 44px tall, filled with Sage/Ink or the accent, with inline Lucide icons at 16px.
- **State:** Status dots (8px circles) signal presence — online green (#3dd68c), offline gray (#667).

### Icons

- Lucide icons, stroke-based: 20px with 1.8 stroke in the phone editor, 16px inside pills. Icons are currentColor and always shrink-proof (`shrink-0`).

## Do's and Don'ts

### Do:

- **Do** read every color from theme tokens (`var(--primary)`, `var(--muted)`, etc.) so a surface keeps working across all six themes.
- **Do** keep the single narrow 440px column and the 16px/12px rhythm; do not widen the desktop host into a dashboard.
- **Do** use the full pill (999px) for compact controls and the 10px family for cards/inputs.
- **Do** separate surfaces with tonal values (Mist/Sage/Card White), never with shadows.

### Don't:

- **Don't** hard-code a hex color in a component — this is the exact drift the Theme Tokens Rule forbids.
- **Don't** add a second accent color; the One Accent Rule keeps Meadow Green (or the active theme's primary) as the single source of emphasis.
- **Don't** introduce box-shadows to lift surfaces; the system is flat-by-default.
- **Do** keep the phone editor on theme tokens (background, secondary, primary, border) so it follows the same system as the rest of the app; never reintroduce a fixed dark palette.
