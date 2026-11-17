import { notificationFeedback } from "@tauri-apps/plugin-haptics";

const KEY = "fs.vibrate";

export function vibrateEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setVibrateEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // storage blocked: setting just won't persist
  }
}

export function buzzIfEnabled(): void {
  if (vibrateEnabled()) {
    void notificationFeedback("success").catch(() => {});
  }
}
