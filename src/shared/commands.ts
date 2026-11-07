import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { en } from "./locales/en";
import type { Settings } from "./settings";

export type Surface = "phone" | "desktop";

export type PhoneView = {
  id: string;
  name: string;
  trust: "unknown" | "pending" | "trusted" | "forgotten";
};

export type HostStatus = {
  ready: boolean;
  pcName: string;
  retentionDays: number;
  qrPngBase64: string;
  pairCode: string;
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

export type HistoryImage = {
  id: string;
  pinned?: boolean;
};

export type HistoryBatch = {
  id: string;
  phoneName: string;
  receivedAt: string;
  images: HistoryImage[];
};

export type Destination = {
  pcId: string;
  name: string;
  online: boolean;
};

export type PairResult = {
  status: "pending" | "trusted" | "rejected" | "needs_forget";
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
    },
    {
      id: "batch-old",
      phoneName: "Work iPhone",
      receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
      images: [{ id: "image-c" }],
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
        pairCode: "482910",
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
        .filter((batch) => batch.images.length > 0);
      return Promise.resolve();
    }
    return invoke("delete_history_image", { imageId });
  },

  deleteHistory(): Promise<void> {
    if (!inTauri()) {
      preview.history = [];
      return Promise.resolve();
    }
    return invoke("delete_history");
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

  pairWithCode(code: string, address?: string): Promise<PairResult> {
    if (!inTauri()) {
      if (code.trim().length !== 6) {
        return Promise.reject(new Error(en.rejected));
      }
      preview.paired = true;
      return Promise.resolve({ status: "trusted" });
    }
    return invoke<PairResult>("pair_with_code", { code, address: address?.trim() || null });
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
};
