import { notificationFeedback } from "@tauri-apps/plugin-haptics";
import { errorText, note } from "./log";

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
  if (!vibrateEnabled()) {
    return;
  }
  // Android: own native pattern (the plugin's is too faint to feel). iOS keeps the plugin.
  const bridge = window.__FAST_SHARE_ANDROID__;
  if (bridge?.vibrateSuccess) {
    try {
      bridge.vibrateSuccess();
    } catch {
      // no vibrator: nothing to do
    }
    return;
  }
  // The capability must allow this command by name: the plugin has no default permission set.
  void notificationFeedback("success").catch((error: unknown) => {
    note(`haptics: ${errorText(error)}`);
  });
}
