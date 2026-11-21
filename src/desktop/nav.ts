export type DesktopView = "history" | "devices" | "settings";

// Set by mountDesktop, so the frame can switch screens without importing them (no import cycle).
let navigator: (view: DesktopView) => void = () => {};

export function setDesktopNavigator(next: (view: DesktopView) => void): void {
  navigator = next;
}

export function navigateDesktop(view: DesktopView): void {
  navigator(view);
}
