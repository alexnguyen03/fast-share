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
  pending: PhoneView[];
  trustedCount: number;
};

export type HistoryImage = {
  id: string;
  pngBase64: string;
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
  status: "pending" | "trusted" | "rejected";
};

type Preview = {
  settings: Settings;
  phones: PhoneView[];
  history: HistoryBatch[];
  destinations: Destination[];
  paired: boolean;
};

const preview: Preview = {
  settings: { historyRetentionDays: 7, pcDisplayName: "Office PC" },
  phones: [
    { id: "phone-work-1", name: "Work iPhone", trust: "trusted" },
    { id: "phone-new-1", name: "Kitchen iPhone", trust: "pending" },
  ],
  history: [],
  destinations: [
    { pcId: "pc-office-1", name: "Office PC", online: true },
    { pcId: "pc-home-1", name: "Home laptop", online: true },
  ],
  paired: true,
};

function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import("@tauri-apps/api/core");
  return call<T>(command, args);
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
  preview.history = [
    {
      id: "batch-new",
      phoneName: "Work iPhone",
      receivedAt: new Date().toISOString(),
      images: [
        { id: "image-a", pngBase64: first },
        { id: "image-b", pngBase64: second },
      ],
    },
    {
      id: "batch-old",
      phoneName: "Work iPhone",
      receivedAt: new Date(Date.now() - 86_400_000).toISOString(),
      images: [{ id: "image-c", pngBase64: first }],
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

  async hostStatus(): Promise<HostStatus> {
    if (!inTauri()) {
      await ensurePreview();
      return {
        ready: true,
        pcName: preview.settings.pcDisplayName,
        retentionDays: preview.settings.historyRetentionDays,
        qrPngBase64: await samplePng("QR", "#f4f7fb"),
        pending: preview.phones.filter((phone) => phone.trust === "pending"),
        trustedCount: preview.phones.filter((phone) => phone.trust === "trusted").length,
      };
    }
    return invoke<HostStatus>("host_status");
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

  sendBatch(pcId: string, images: string[]): Promise<void> {
    if (!inTauri()) {
      if (!preview.destinations.some((pc) => pc.pcId === pcId && pc.online)) {
        return Promise.reject(new Error(en.offline));
      }
      return Promise.resolve();
    }
    return invoke("send_batch", { pcId, images });
  },

  async onHistoryFocus(refresh: () => void): Promise<() => void> {
    if (!inTauri()) {
      return () => undefined;
    }
    const { listen } = await import("@tauri-apps/api/event");
    return listen("history-focus", () => refresh());
  },
};
