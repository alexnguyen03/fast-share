import { convertFileSrc, invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { en } from "./locales/en";
import type { Settings } from "./settings";

export type Surface = "phone" | "desktop";

export type PhoneView = {
  id: string;
  name: string;
  trust: "unknown" | "pending" | "trusted" | "forgotten";
  /** Six digits to compare with the phone, when it asked without a QR code. */
  sas?: string | null;
};

export type HostStatus = {
  ready: boolean;
  pcName: string;
  retentionDays: number;
  qrPngBase64: string;
  lanAddress: string;
  firewallWarning: string | null;
  pending: PhoneView[];
  trustedCount: number;
};

export type NearbyPc = {
  pcId: string;
  name: string;
  host: string;
  port: number;
  paired: boolean;
};

export type LanInfo = {
  ip: string;
  subnet: string;
  addresses: { name: string; ip: string }[];
};

export type HistoryImage = {
  id: string;
  pinned?: boolean;
  /** File size in bytes; 0 when unknown. */
  size?: number;
};

export type HistoryText = {
  id: string;
  /** First characters only; copying uses the full text on the computer. */
  preview: string;
  pinned?: boolean;
  /** The user's choice to mask it; null/absent lets the app guess from the text. */
  sensitive?: boolean | null;
};

export type HistoryBatch = {
  id: string;
  phoneName: string;
  receivedAt: string;
  images: HistoryImage[];
  texts: HistoryText[];
};

export type Destination = {
  pcId: string;
  name: string;
  online: boolean;
};

export type RelayState =
  | { state: "off" }
  | { state: "connecting" }
  | { state: "connected" }
  | { state: "error"; message: string };

export type RelayView = {
  url: string | null;
  hasToken: boolean;
  status: RelayState;
};

export type PairResult = {
  status: "pending" | "trusted" | "rejected";
  /** Six digits to compare with the computer while waiting. */
  sas?: string | null;
};

export type PhoneIdentity = {
  deviceId: string;
  name: string;
};

export type WindowPrefs = {
  snapToEdge: boolean;
  alwaysOnTop: boolean;
  dockEdge: "left" | "right" | "top" | "bottom" | null;
  dockExpanded: boolean;
  dockX: number;
  dockY: number;
};

type Preview = {
  settings: Settings;
  windowPrefs: WindowPrefs;
  phones: PhoneView[];
  history: HistoryBatch[];
  images: Record<string, string>;
  destinations: Destination[];
  paired: boolean;
  phoneIdentity: PhoneIdentity;
};

const preview: Preview = {
  settings: {
    historyRetentionDays: 7,
    pcDisplayName: "Office PC",
    autoStartWithOs: false,
    closeToTray: true,
    autoCopyToClipboard: true,
    theme: "emerald-light",
  },
  windowPrefs: {
    snapToEdge: true,
    alwaysOnTop: false,
    dockEdge: null,
    dockExpanded: true,
    dockX: 160,
    dockY: 120,
  },
  phones: [
    { id: "phone-work-1", name: "Work iPhone", trust: "trusted" },
    { id: "phone-new-1", name: "Kitchen iPhone", trust: "pending" },
  ],
  history: [],
  images: {},
  destinations: [
    { pcId: "pc-office-1", name: "Office PC", online: true },
    { pcId: "pc-home-1", name: "Home laptop", online: true },
  ],
  paired: true,
  phoneIdentity: { deviceId: "phone-preview", name: "My iPhone" },
};

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return tauriInvoke<T>(command, args);
}

async function samplePng(label: string, hue: string): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 400;
  const context = canvas.getContext("2d");
  if (!context) {
    return "";
  }
  context.fillStyle = "#1c2430";
  context.fillRect(0, 0, 640, 400);
  context.fillStyle = hue;
  context.fillRect(70, 60, 220, 150);
  context.fillStyle = "#f4f7fb";
  context.font = "28px sans-serif";
  context.fillText(label, 70, 280);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) {
    return "";
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

async function ensurePreview(): Promise<void> {
  if (preview.history.length > 0) {
    return;
  }
  const first = await samplePng("Screenshot", "#e23d3d");
  const second = await samplePng("Second", "#6ea8fe");
  preview.images = {
    "image-a": first,
    "image-b": second,
    "image-c": first,
  };
  preview.history = [
    {
      id: "batch-new",
      phoneName: "Work iPhone",
      receivedAt: new Date().toISOString(),
      images: [{ id: "image-a" }, { id: "image-b" }],
      texts: [],
    },
    {
      id: "batch-text",
      phoneName: "Work iPhone",
      receivedAt: new Date(Date.now() - 3_600_000).toISOString(),
      images: [],
      texts: [{ id: "text-a", preview: "https://example.com/a-link-copied-on-the-phone" }],
    },
    {
      id: "batch-old",
      phoneName: "Work iPhone",
      receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
      images: [{ id: "image-c" }],
      texts: [],
    },
  ];
}

export const api = {
  surface(): Promise<Surface> {
    if (!inTauri()) {
      const requested = new URLSearchParams(window.location.search).get("surface");
      return Promise.resolve(requested === "phone" ? "phone" : "desktop");
    }
    return invoke<Surface>("surface");
  },

  startWindowDrag(): void {
    if (!inTauri()) {
      return;
    }
    void tauriInvoke("start_drag").catch(() => {
      void getCurrentWindow().startDragging();
    });
  },

  getWindowPrefs(): Promise<WindowPrefs> {
    if (!inTauri()) {
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("get_window_prefs");
  },

  setWindowPrefs(patch: {
    snapToEdge?: boolean;
    alwaysOnTop?: boolean;
  }): Promise<WindowPrefs> {
    if (!inTauri()) {
      preview.windowPrefs = { ...preview.windowPrefs, ...patch };
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("set_window_prefs", patch);
  },

  toggleDockExpanded(): Promise<WindowPrefs> {
    if (!inTauri()) {
      preview.windowPrefs.dockExpanded = !preview.windowPrefs.dockExpanded;
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("toggle_dock_expanded");
  },

  slideDocked(deltaX: number, deltaY: number): Promise<WindowPrefs> {
    if (!inTauri()) {
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("slide_docked", { deltaX, deltaY });
  },

  undockAndDrag(): Promise<WindowPrefs> {
    if (!inTauri()) {
      preview.windowPrefs.dockEdge = null;
      preview.windowPrefs.dockExpanded = true;
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("undock_and_drag");
  },

  quitApp(): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("quit_app");
  },

  hideToEdge(): Promise<WindowPrefs> {
    if (!inTauri()) {
      preview.windowPrefs.dockEdge = preview.windowPrefs.dockEdge ?? "right";
      preview.windowPrefs.dockExpanded = false;
      return Promise.resolve({ ...preview.windowPrefs });
    }
    return invoke<WindowPrefs>("hide_to_edge");
  },

  /** Full-screen preview window that steps through `ids`, starting at `index`. */
  openPreview(ids: string[], index: number): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("open_preview", { ids, index });
  },

  /** The phone's Wi-Fi name, or "" when unknown (no location permission, not on Wi-Fi). */
  async wifiName(): Promise<string> {
    const bridge = window.__FAST_SHARE_ANDROID__;
    if (bridge?.wifiName) {
      return bridge.wifiName();
    }
    if (!inTauri()) {
      return "";
    }
    return (await invoke<string | null>("wifi_name")) ?? "";
  },

  /** Shows the system prompt that lets the app read the Wi-Fi name. */
  requestWifiPermission(): Promise<void> {
    const bridge = window.__FAST_SHARE_ANDROID__;
    if (bridge?.requestLocationForWifi) {
      bridge.requestLocationForWifi();
      return Promise.resolve();
    }
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("request_wifi_permission");
  },

  closeThisWindow(): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return getCurrentWindow().close();
  },

  async onPreviewOpen(cb: (ids: string[], index: number) => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<{ ids: string[]; index: number }>("preview-open", (event) => {
      cb(event.payload.ids, event.payload.index);
    });
  },

  async onDockState(cb: (prefs: WindowPrefs) => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<WindowPrefs>("dock-state", (event) => {
      cb(event.payload);
    });
  },

  async hostStatus(): Promise<HostStatus> {
    if (!inTauri()) {
      await ensurePreview();
      return {
        ready: true,
        pcName: preview.settings.pcDisplayName,
        retentionDays: preview.settings.historyRetentionDays,
        qrPngBase64: await samplePng("QR", "#f4f7fb"),
        lanAddress: "192.168.1.24:47654",
        firewallWarning: null,
        pending: preview.phones.filter((phone) => phone.trust === "pending"),
        trustedCount: preview.phones.filter((phone) => phone.trust === "trusted").length,
      };
    }
    return invoke<HostStatus>("host_status");
  },

  allowFirewall(): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("allow_firewall");
  },

  lanInfo(): Promise<LanInfo> {
    if (!inTauri()) {
      return Promise.resolve({
        ip: "192.168.1.24",
        subnet: "192.168.1.0/24",
        addresses: [{ name: "Wi-Fi", ip: "192.168.1.24" }],
      });
    }
    return invoke<LanInfo>("lan_info");
  },

  listPhones(): Promise<PhoneView[]> {
    if (!inTauri()) {
      return Promise.resolve(preview.phones);
    }
    return invoke<PhoneView[]>("list_phones");
  },

  acceptPhone(deviceId: string): Promise<void> {
    if (!inTauri()) {
      const phone = preview.phones.find((item) => item.id === deviceId);
      if (phone) {
        phone.trust = "trusted";
      }
      return Promise.resolve();
    }
    return invoke("accept_phone", { deviceId });
  },

  rejectPhone(deviceId: string): Promise<void> {
    if (!inTauri()) {
      preview.phones = preview.phones.filter((item) => item.id !== deviceId);
      return Promise.resolve();
    }
    return invoke("reject_phone", { deviceId });
  },

  forgetPhone(deviceId: string): Promise<void> {
    if (!inTauri()) {
      const phone = preview.phones.find((item) => item.id === deviceId);
      if (phone) {
        phone.trust = "forgotten";
      }
      return Promise.resolve();
    }
    return invoke("forget_phone", { deviceId });
  },

  async listHistory(): Promise<HistoryBatch[]> {
    if (!inTauri()) {
      await ensurePreview();
      return preview.history;
    }
    return invoke<HistoryBatch[]>("list_history");
  },

  async getHistoryImage(imageId: string): Promise<string> {
    if (!inTauri()) {
      await ensurePreview();
      return preview.images[imageId] ?? "";
    }
    return invoke<string>("get_history_image", { imageId });
  },

  copyHistoryImage(imageId: string): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("copy_history_image", { imageId });
  },

  openHistoryImage(imageId: string): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("open_history_image", { imageId });
  },

  revealHistoryImage(imageId: string): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("reveal_history_image", { imageId });
  },

  copyHistoryImagePath(imageId: string): Promise<string> {
    if (!inTauri()) {
      return Promise.resolve(`/preview/${imageId}.png`);
    }
    return invoke<string>("copy_history_image_path", { imageId });
  },

  togglePinImage(imageId: string): Promise<boolean> {
    if (!inTauri()) {
      let nextPinned = false;
      preview.history = preview.history.map((batch) => ({
        ...batch,
        images: batch.images.map((image) => {
          if (image.id === imageId) {
            nextPinned = !image.pinned;
            return { ...image, pinned: nextPinned };
          }
          return image;
        }),
      }));
      return Promise.resolve(nextPinned);
    }
    return invoke<boolean>("toggle_pin_image", { imageId });
  },

  startFileDrag(imageId: string): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("start_file_drag", { imageId });
  },

  deleteHistoryImage(imageId: string): Promise<void> {
    if (!inTauri()) {
      preview.history = preview.history
        .map((batch) => ({
          ...batch,
          images: batch.images.filter((image) => image.id !== imageId),
        }))
        .filter((batch) => batch.images.length > 0 || batch.texts.length > 0);
      return Promise.resolve();
    }
    return invoke("delete_history_image", { imageId });
  },

  /**
   * A URL an `<img>` loads directly (no base64 through the bridge): `thumb` is a small JPEG for
   * lists, `full` the original file. Null outside the app, where callers fall back to base64.
   */
  imageUrl(imageId: string, kind: "thumb" | "full"): string | null {
    return inTauri() ? convertFileSrc(`${kind}-${imageId}`, "fsimg") : null;
  },

  copyHistoryText(textId: string): Promise<void> {
    if (!inTauri()) {
      return Promise.resolve();
    }
    return invoke("copy_history_text", { textId });
  },

  getHistoryText(textId: string): Promise<string> {
    if (!inTauri()) {
      const text = preview.history.flatMap((batch) => batch.texts).find((t) => t.id === textId);
      return Promise.resolve(text?.preview ?? "");
    }
    return invoke<string>("get_history_text", { textId });
  },

  togglePinText(textId: string): Promise<boolean> {
    if (!inTauri()) {
      let nextPinned = false;
      preview.history = preview.history.map((batch) => ({
        ...batch,
        texts: batch.texts.map((text) => {
          if (text.id !== textId) {
            return text;
          }
          nextPinned = !text.pinned;
          return { ...text, pinned: nextPinned };
        }),
      }));
      return Promise.resolve(nextPinned);
    }
    return invoke<boolean>("toggle_pin_text", { textId });
  },

  setTextSensitive(textId: string, sensitive: boolean | null): Promise<void> {
    if (!inTauri()) {
      preview.history = preview.history.map((batch) => ({
        ...batch,
        texts: batch.texts.map((text) => (text.id === textId ? { ...text, sensitive } : text)),
      }));
      return Promise.resolve();
    }
    return invoke("set_text_sensitive", { textId, sensitive });
  },

  deleteHistoryText(textId: string): Promise<void> {
    if (!inTauri()) {
      preview.history = preview.history
        .map((batch) => ({
          ...batch,
          texts: batch.texts.filter((text) => text.id !== textId),
        }))
        .filter((batch) => batch.images.length > 0 || batch.texts.length > 0);
      return Promise.resolve();
    }
    return invoke("delete_history_text", { textId });
  },

  deleteHistory(): Promise<void> {
    if (!inTauri()) {
      preview.history = [];
      return Promise.resolve();
    }
    return invoke("delete_history");
  },

  getRelay(): Promise<RelayView> {
    if (!inTauri()) {
      return Promise.resolve({ url: null, hasToken: false, status: { state: "off" } });
    }
    return invoke<RelayView>("get_relay");
  },

  /** Saves the relay string the admin pasted; empty text removes the relay. */
  setRelay(text: string): Promise<RelayView> {
    if (!inTauri()) {
      return Promise.resolve({ url: null, hasToken: false, status: { state: "off" } });
    }
    return invoke<RelayView>("set_relay", { text });
  },

  /** Sends a probe through the relay back to this computer; resolves with milliseconds. */
  testRelay(): Promise<number> {
    if (!inTauri()) {
      return Promise.resolve(42);
    }
    return invoke<number>("test_relay");
  },

  async onRelayChanged(cb: () => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<null>("relay-changed", () => {
      cb();
    });
  },

  getSettings(): Promise<Settings> {
    if (!inTauri()) {
      return Promise.resolve({ ...preview.settings });
    }
    return invoke<Settings>("get_settings");
  },

  updateSettings(patch: Partial<Settings>): Promise<Settings> {
    if (!inTauri()) {
      preview.settings = { ...preview.settings, ...patch };
      return Promise.resolve({ ...preview.settings });
    }
    return invoke<Settings>("update_host_settings", { patch: JSON.stringify(patch) });
  },

  async takeSharedImages(): Promise<string[]> {
    if (!inTauri()) {
      return [await samplePng("One", "#e23d3d"), await samplePng("Two", "#6ea8fe")];
    }
    return invoke<string[]>("take_shared_images");
  },

  phoneIdentity(): Promise<PhoneIdentity> {
    if (!inTauri()) {
      return Promise.resolve({ ...preview.phoneIdentity });
    }
    return invoke<PhoneIdentity>("phone_identity");
  },

  setPhoneName(name: string): Promise<void> {
    if (!inTauri()) {
      preview.phoneIdentity.name = name.trim();
      return Promise.resolve();
    }
    return invoke("set_phone_name", { name });
  },

  listKnownPcs(): Promise<Destination[]> {
    if (!inTauri()) {
      return Promise.resolve(preview.destinations);
    }
    return invoke<Destination[]>("list_known_pcs");
  },

  discoverDestinations(): Promise<Destination[]> {
    if (!inTauri()) {
      return Promise.resolve(preview.destinations);
    }
    return invoke<Destination[]>("discover_destinations");
  },

  pairWithQr(payload: string): Promise<PairResult> {
    if (!inTauri()) {
      if (!payload.trim()) {
        return Promise.reject(new Error(en.rejected));
      }
      preview.paired = true;
      return Promise.resolve({ status: "trusted" });
    }
    return invoke<PairResult>("pair_with_qr", { payload });
  },

  /** Connect without a QR code: a computer found on the Wi-Fi, or a typed address. */
  pairNearby(pcId?: string, address?: string): Promise<PairResult> {
    if (!inTauri()) {
      preview.paired = true;
      return Promise.resolve({ status: "pending", sas: "482910" });
    }
    return invoke<PairResult>("pair_nearby", {
      pcId: pcId ?? null,
      address: address?.trim() || null,
    });
  },

  discoverNearbyPcs(): Promise<NearbyPc[]> {
    if (!inTauri()) {
      return Promise.resolve([
        { pcId: "pc-office-1", name: "Office PC", host: "192.168.1.24", port: 47654, paired: true },
      ]);
    }
    return invoke<NearbyPc[]>("discover_nearby_pcs");
  },

  pollPair(pcId: string): Promise<PairResult> {
    if (!inTauri()) {
      return Promise.resolve({ status: preview.paired ? "trusted" : "pending" });
    }
    return invoke<PairResult>("poll_pair", { pcId });
  },

  forgetPc(pcId: string): Promise<void> {
    if (!inTauri()) {
      preview.destinations = preview.destinations.filter((pc) => pc.pcId !== pcId);
      return Promise.resolve();
    }
    return invoke("forget_pc", { pcId });
  },

  sendBatch(pcId: string, batchId: string, images: string[]): Promise<void> {
    if (!inTauri()) {
      if (!preview.destinations.some((pc) => pc.pcId === pcId && pc.online)) {
        return Promise.reject(new Error(en.offline));
      }
      return Promise.resolve();
    }
    return invoke("send_batch", { pcId, batchId, images });
  },

  sendText(pcId: string, batchId: string, text: string): Promise<void> {
    if (!inTauri()) {
      if (!preview.destinations.some((pc) => pc.pcId === pcId && pc.online)) {
        return Promise.reject(new Error(en.offline));
      }
      return Promise.resolve();
    }
    return invoke("send_text", { pcId, batchId, text });
  },

  async onHistoryFocus(refresh: (batchId?: string) => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    const unlistenFocus = await listen<string>("history-focus", (event) => {
      refresh(typeof event.payload === "string" && event.payload.length > 0 ? event.payload : undefined);
    });
    const unlistenUpdated = await listen<string>("history-updated", () => {
      refresh();
    });
    const unlistenPair = await listen<string>("device-pair-event", () => {
      refresh();
    });
    return () => {
      unlistenFocus();
      unlistenUpdated();
      unlistenPair();
    };
  },

  async onDevicePairEvent(cb: (name: string) => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("device-pair-event", (event) => {
      if (typeof event.payload === "string" && event.payload.length > 0) {
        cb(event.payload);
      }
    });
  },

  async onLanChanged(cb: () => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen<null>("lan-changed", () => {
      cb();
    });
  },
};
