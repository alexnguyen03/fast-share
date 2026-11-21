export type DesktopView = "history" | "devices" | "settings";
export type HistoryTab = "images" | "clipboard";

// Set by mountDesktop, so the frame can switch screens without importing them (no import cycle).
let navigator: (view: DesktopView) => void = () => {};

export function setDesktopNavigator(next: (view: DesktopView) => void): void {
  navigator = next;
}

export function navigateDesktop(view: DesktopView): void {
  navigator(view);
}

const TAB_KEY = "fs.desktop.tab";

export function loadTab(): HistoryTab {
  try {
    return localStorage.getItem(TAB_KEY) === "clipboard" ? "clipboard" : "images";
  } catch {
    return "images";
  }
}

export function saveTab(tab: HistoryTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // only a convenience; the next start opens on Images
  }
}
