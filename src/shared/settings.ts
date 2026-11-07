export type AppTheme =
  | "emerald-light"
  | "solarized-light"
  | "catppuccin-latte"
  | "solarized-dark"
  | "tokyo-night"
  | "catppuccin-mocha";

export type ThemePreset = {
  id: AppTheme;
  mode: "light" | "dark";
  bg: string;
  surface: string;
  primary: string;
  fg: string;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "emerald-light",
    mode: "light",
    bg: "#fbfdf8",
    surface: "#f0f3ee",
    primary: "#0f8a4b",
    fg: "#161a1d",
  },
  {
    id: "solarized-light",
    mode: "light",
    bg: "#fdf6e3",
    surface: "#eee8d5",
    primary: "#268bd2",
    fg: "#073642",
  },
  {
    id: "catppuccin-latte",
    mode: "light",
    bg: "#eff1f5",
    surface: "#e6e9ef",
    primary: "#1e66f5",
    fg: "#4c4f69",
  },
  {
    id: "solarized-dark",
    mode: "dark",
    bg: "#002b36",
    surface: "#073642",
    primary: "#2aa198",
    fg: "#eee8d5",
  },
  {
    id: "tokyo-night",
    mode: "dark",
    bg: "#1a1b26",
    surface: "#24283b",
    primary: "#7aa2f7",
    fg: "#c0caf5",
  },
  {
    id: "catppuccin-mocha",
    mode: "dark",
    bg: "#1e1e2e",
    surface: "#313244",
    primary: "#89b4fa",
    fg: "#cdd6f4",
  },
];

export type Settings = {
  historyRetentionDays: number;
  pcDisplayName: string;
  autoStartWithOs: boolean;
  closeToTray: boolean;
  autoCopyToClipboard: boolean;
  theme: AppTheme;
};

declare global {
  interface Window {
    __FAST_SHARE_ANDROID__?: {
      setSystemBars(isLightTheme: boolean, bgHex: string): void;
    };
  }
}

export function applyTheme(theme: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const preset =
    THEME_PRESETS.find((item) => item.id === theme) ?? THEME_PRESETS[0];
  document.documentElement.setAttribute("data-theme", preset.id);
  document.documentElement.classList.toggle("dark", preset.mode === "dark");
  document.documentElement.style.colorScheme = preset.mode;
  if (typeof window !== "undefined") {
    window.__FAST_SHARE_ANDROID__?.setSystemBars(
      preset.mode === "light",
      preset.bg,
    );
  }
}
