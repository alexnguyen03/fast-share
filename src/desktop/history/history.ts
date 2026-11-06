import { api, type HistoryBatch } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { mountPhones } from "../devices/devices";
import { mountSettings } from "../settings/settings";

const imageCache = new Map<string, string>();

type FlatItem = {
  imageId: string;
  batchId: string;
  phoneName: string;
  receivedAt: string;
};

export function createDesktopFrame(): { outer: HTMLElement; card: HTMLElement } {
  const outer = document.createElement("div");
  outer.className = "desk-window";

  const tab = document.createElement("div");
  tab.className = "desk-drag-tab";
  tab.setAttribute("data-tauri-drag-region", "");
  const tabLabel = document.createElement("span");
  tabLabel.setAttribute("data-tauri-drag-region", "");
  tabLabel.textContent = en.appName;
  tab.append(tabLabel);
  tab.addEventListener("mousedown", (event) => {
    if (event.button === 0) {
      void api.startWindowDrag();
    }
  });

  const card = document.createElement("section");
  card.className = "desk-card";
  outer.append(tab, card);
  return { outer, card };
}

async function loadPng(imageId: string): Promise<string> {
  const cached = imageCache.get(imageId);
  if (cached) {
    return cached;
  }
  const png = await api.getHistoryImage(imageId);
  if (png) {
    imageCache.set(imageId, png);
  }
  return png;
}

function flattenBatches(batches: HistoryBatch[], deviceFilter: string): FlatItem[] {
  const items: FlatItem[] = [];
  for (const batch of batches) {
    if (deviceFilter !== "all" && batch.phoneName !== deviceFilter) {
      continue;
    }
    for (const img of batch.images) {
      items.push({
        imageId: img.id,
        batchId: batch.id,
        phoneName: batch.phoneName,
        receivedAt: batch.receivedAt,
      });
    }
  }
  return items;
}

export async function mountDesktop(root: HTMLElement): Promise<void> {
  let batches = await api.listHistory();
  let status = await api.hostStatus();
  let deviceFilter = "all";
  let selectMode = false;
  const selectedIds = new Set<string>();
  let activeImageId: string | null = null;
  let active = true;

  const unlisten = await api.onHistoryFocus((targetBatchId) => {
    void reload(targetBatchId);
  });

  function cleanup(): void {
    if (!active) {
      return;
    }
    active = false;
    window.removeEventListener("keydown", onKey);
    unlisten();
  }

  async function reload(targetBatchId?: string): Promise<void> {
    if (!active) {
      return;
    }
    batches = await api.listHistory();
    status = await api.hostStatus();
    if (targetBatchId) {
      const target = batches.find((item) => item.id === targetBatchId);
      if (target?.images[0]) {
        activeImageId = target.images[0].id;
      }
    }
    paint();
  }

  function paint(): void {
    if (!active) {
      return;
    }
    const { outer, card } = createDesktopFrame();
    const deviceNames = Array.from(new Set(batches.map((b) => b.phoneName)));
    if (deviceFilter !== "all" && !deviceNames.includes(deviceFilter)) {
      deviceFilter = "all";
    }
    const items = flattenBatches(batches, deviceFilter);
    for (const id of Array.from(selectedIds)) {
      if (!items.some((item) => item.imageId === id)) {
        selectedIds.delete(id);
      }
    }
    if (!activeImageId || !items.some((item) => item.imageId === activeImageId)) {
      activeImageId = items[0]?.imageId ?? null;
    }

    const header = document.createElement("header");
    header.className = "desk-header";

    const filterSelect = document.createElement("select");
    filterSelect.className = "desk-filter-select";
    filterSelect.setAttribute("aria-label", en.recently);
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = en.recently;
    filterSelect.append(allOpt);
    for (const name of deviceNames) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      filterSelect.append(opt);
    }
    filterSelect.value = deviceFilter;
    filterSelect.addEventListener("change", () => {
      deviceFilter = filterSelect.value;
      paint();
    });

    const selectBtn = document.createElement("button");
    selectBtn.type = "button";
    selectBtn.className = selectMode ? "desk-link-btn active" : "desk-link-btn";
    selectBtn.textContent = selectMode ? en.done : en.select;
    selectBtn.addEventListener("click", () => {
      selectMode = !selectMode;
      if (!selectMode) {
        selectedIds.clear();
      }
      paint();
    });

    header.append(filterSelect, selectBtn);
    card.append(header);

    if (selectMode) {
      const actionBar = document.createElement("div");
      actionBar.className = "desk-select-bar";

      const copyBtn = document.createElement("button");
      copyBtn.type = "button";
      copyBtn.className = "primary";
      copyBtn.disabled = selectedIds.size === 0;
      copyBtn.textContent =
        selectedIds.size > 0 ? `${en.copy} (${selectedIds.size})` : en.copy;
      copyBtn.addEventListener("click", () => {
        const first = Array.from(selectedIds)[0];
        if (first) {
          void api.copyHistoryImage(first);
        }
      });

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.disabled = selectedIds.size === 0;
      openBtn.textContent = en.open;
      openBtn.addEventListener("click", () => {
        const first = Array.from(selectedIds)[0];
        if (first) {
          void api.openHistoryImage(first);
        }
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.disabled = selectedIds.size === 0;
      delBtn.textContent =
        selectedIds.size > 0 ? `${en.delete} (${selectedIds.size})` : en.delete;
      delBtn.addEventListener("click", () => {
        const targets = Array.from(selectedIds);
        if (targets.length === 0) {
          return;
        }
        void Promise.all(
          targets.map((id) => {
            imageCache.delete(id);
            return api.deleteHistoryImage(id);
          }),
        ).then(() => {
          selectedIds.clear();
          return reload();
        });
      });

      const delAllBtn = document.createElement("button");
      delAllBtn.type = "button";
      delAllBtn.disabled = items.length === 0;
      delAllBtn.textContent = en.deleteAll;
      delAllBtn.addEventListener("click", () => {
        if (!window.confirm(en.deleteAllConfirm)) {
          return;
        }
        imageCache.clear();
        selectedIds.clear();
        void api.deleteHistory().then(() => reload());
      });

      actionBar.append(copyBtn, openBtn, delBtn, delAllBtn);
      card.append(actionBar);
    }

    const body = document.createElement("div");
    body.className = "desk-grid-wrap";

    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "desk-empty";
      empty.textContent = en.emptyHistory;
      body.append(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "desk-grid";
      for (const item of items) {
        const isSelected = selectMode
          ? selectedIds.has(item.imageId)
          : item.imageId === activeImageId;
        grid.append(
          gridTile(
            item,
            isSelected,
            selectMode,
            () => {
              activeImageId = item.imageId;
              if (selectMode) {
                if (selectedIds.has(item.imageId)) {
                  selectedIds.delete(item.imageId);
                } else {
                  selectedIds.add(item.imageId);
                }
                paint();
              } else {
                void api.copyHistoryImage(item.imageId);
                paint();
              }
            },
            () => {
              void api.openHistoryImage(item.imageId);
            },
          ),
        );
      }
      body.append(grid);
    }

    for (const pending of status.pending) {
      body.append(
        pendingDialog(pending.name, async (accepted) => {
          if (accepted) {
            await api.acceptPhone(pending.id);
          } else {
            await api.rejectPhone(pending.id);
          }
          await reload();
        }),
      );
    }

    const footer = document.createElement("footer");
    footer.className = "desk-bottom-nav";

    const devicesBtn = document.createElement("button");
    devicesBtn.type = "button";
    devicesBtn.className = "desk-nav-icon";
    devicesBtn.setAttribute("aria-label", en.devicesTitle);
    devicesBtn.title = en.devicesTitle;
    devicesBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><circle cx="12" cy="18.5" r="0.9"/></svg>`;
    if (status.pending.length > 0) {
      const badge = document.createElement("span");
      badge.className = "desk-badge";
      badge.textContent = String(status.pending.length);
      devicesBtn.append(badge);
    }
    devicesBtn.addEventListener("click", () => {
      cleanup();
      void mountPhones(root, () => {
        void mountDesktop(root);
      });
    });

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "desk-nav-icon";
    settingsBtn.setAttribute("aria-label", en.settings);
    settingsBtn.title = en.settings;
    settingsBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.77 1.02 1.41 1.09H21a2 2 0 1 1 0 4h-.09c-.64.07-1.15.49-1.51 1Z"/></svg>`;
    settingsBtn.addEventListener("click", () => {
      cleanup();
      void mountSettings(root, () => {
        void mountDesktop(root);
      });
    });

    footer.append(devicesBtn, settingsBtn);
    card.append(body, footer);
    root.replaceChildren(outer);
  }

  function onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      return;
    }
    const targetId =
      selectMode && selectedIds.size > 0
        ? Array.from(selectedIds)[0]
        : activeImageId;
    if (!targetId) {
      return;
    }
    if (event.key === "c" || event.key === "C") {
      void api.copyHistoryImage(targetId);
    }
    if (event.key === "o" || event.key === "O") {
      void api.openHistoryImage(targetId);
    }
    if (event.key === "Delete") {
      if (selectMode && selectedIds.size > 0) {
        const ids = Array.from(selectedIds);
        void Promise.all(
          ids.map((id) => {
            imageCache.delete(id);
            return api.deleteHistoryImage(id);
          }),
        ).then(() => {
          selectedIds.clear();
          return reload();
        });
      } else {
        imageCache.delete(targetId);
        void api.deleteHistoryImage(targetId).then(() => reload());
      }
    }
  }

  window.addEventListener("keydown", onKey);
  paint();
}

function gridTile(
  item: FlatItem,
  selected: boolean,
  selectMode: boolean,
  onClick: () => void,
  onDoubleClick: () => void,
): HTMLButtonElement {
  const tile = document.createElement("button");
  tile.type = "button";
  tile.className = selected ? "desk-tile selected" : "desk-tile";
  tile.title = `${item.phoneName} · ${relativeTime(item.receivedAt)}`;

  const frame = document.createElement("div");
  frame.className = "desk-tile-img";
  const img = document.createElement("img");
  img.alt = en.image;
  void loadPng(item.imageId).then((png) => {
    if (png) {
      img.src = `data:image/png;base64,${png}`;
    }
  });
  frame.append(img);

  if (selectMode) {
    const check = document.createElement("span");
    check.className = selected ? "desk-check on" : "desk-check";
    check.textContent = selected ? "✓" : "";
    tile.append(check);
  }

  const meta = document.createElement("div");
  meta.className = "desk-tile-meta";
  const dev = document.createElement("span");
  dev.textContent = item.phoneName;
  const when = document.createElement("span");
  when.textContent = relativeTime(item.receivedAt);
  meta.append(dev, when);

  tile.append(frame, meta);
  tile.addEventListener("click", onClick);
  tile.addEventListener("dblclick", onDoubleClick);
  return tile;
}

export function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {
    return en.justNow;
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return en.hoursAgo(hours);
  }
  return en.daysAgo(Math.round(hours / 24));
}

function pendingDialog(name: string, decide: (accepted: boolean) => Promise<void>): HTMLElement {
  const dialog = document.createElement("div");
  dialog.className = "desk-pending-dialog";
  const text = document.createElement("p");
  text.textContent = en.acceptPhone(name);
  const row = document.createElement("div");
  row.className = "row";
  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary";
  accept.textContent = en.accept;
  accept.addEventListener("click", () => {
    void decide(true);
  });
  const reject = document.createElement("button");
  reject.type = "button";
  reject.textContent = en.reject;
  reject.addEventListener("click", () => {
    void decide(false);
  });
  row.append(accept, reject);
  dialog.append(text, row);
  return dialog;
}
