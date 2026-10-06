import { api, type HistoryBatch, type HistoryImage } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { mountPhones } from "../devices/devices";
import { mountSettings } from "../settings/settings";

export async function mountDesktop(root: HTMLElement): Promise<void> {
  let batches = await api.listHistory();
  let status = await api.hostStatus();
  let batchIndex = 0;
  let imageIndex = 0;
  const unlisten = await api.onHistoryFocus(() => {
    void reload();
  });

  async function reload(): Promise<void> {
    batches = await api.listHistory();
    status = await api.hostStatus();
    batchIndex = 0;
    imageIndex = 0;
    paint();
  }

  function paint(): void {
    const shell = document.createElement("section");
    shell.className = "panel desktop";
    shell.innerHTML = `
      <header class="desk-top">
        <div class="brand">
          <strong>${en.appName}</strong>
          <span class="dot${status.ready ? " on" : ""}"></span>
          <span>${en.ready}</span>
        </div>
        <button type="button" class="icon-btn" data-action="phones" aria-label="${en.phones}">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>
        </button>
      </header>
      <div class="desk-body" data-body></div>
      <footer class="foot">
        <button type="button" class="text" data-action="retention"></button>
        <button type="button" class="text" data-action="delete">${en.deleteAll}</button>
      </footer>
    `;
    root.replaceChildren(shell);
    const body = shell.querySelector<HTMLElement>("[data-body]");
    const retention = shell.querySelector<HTMLButtonElement>("[data-action=retention]");
    if (!body || !retention) {
      return;
    }
    retention.textContent = en.deletesAfter(status.retentionDays);
    if (batches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "status show";
      empty.textContent = en.emptyHistory;
      body.append(empty);
    } else {
      const current = batches[batchIndex] ?? batches[0];
      body.append(latest(current, imageIndex, (next) => {
        imageIndex = next;
        paint();
      }, () => {
        const image = current.images[imageIndex];
        if (!image) {
          return;
        }
        void api.deleteHistoryImage(image.id).then(reload);
      }));
      const older = batches.filter((_, index) => index !== batchIndex);
      if (older.length > 0) {
        const label = document.createElement("p");
        label.className = "earlier";
        label.textContent = en.earlier;
        body.append(label);
        batches.forEach((batch, index) => {
          if (index === batchIndex) {
            return;
          }
          body.append(earlierRow(batch, () => {
            batchIndex = index;
            imageIndex = 0;
            paint();
          }));
        });
      }
    }
    const pending = status.pending[0];
    if (pending) {
      body.append(pendingDialog(pending.name, async (accepted) => {
        if (accepted) {
          await api.acceptPhone(pending.id);
        } else {
          await api.rejectPhone(pending.id);
        }
        await reload();
      }));
    }
    shell.querySelector("[data-action=phones]")?.addEventListener("click", () => {
      void mountPhones(root, () => {
        void mountDesktop(root);
      });
    });
    retention.addEventListener("click", () => {
      void mountSettings(root, () => {
        void mountDesktop(root);
      });
    });
    shell.querySelector("[data-action=delete]")?.addEventListener("click", () => {
      if (!window.confirm(en.deleteAllConfirm)) {
        return;
      }
      void api.deleteHistory().then(reload);
    });
  }

  function onKey(event: KeyboardEvent): void {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      return;
    }
    const batch = batches[batchIndex];
    const image = batch?.images[imageIndex];
    if (!image) {
      return;
    }
    if (event.key === "c" || event.key === "C") {
      void api.copyHistoryImage(image.id);
    }
    if (event.key === "o" || event.key === "O") {
      void api.openHistoryImage(image.id);
    }
    if (event.key === "Delete") {
      void api.deleteHistoryImage(image.id).then(reload);
    }
  }

  window.addEventListener("keydown", onKey);
  paint();
  root.addEventListener("fast-share-unmount", () => {
    window.removeEventListener("keydown", onKey);
    void unlisten();
  }, { once: true });
}

function latest(
  batch: HistoryBatch,
  imageIndex: number,
  onSelect: (index: number) => void,
  onDelete: () => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "latest";
  const image = batch.images[imageIndex] ?? batch.images[0];
  const heading = document.createElement("div");
  heading.className = "batch-title";
  const title = document.createElement("strong");
  title.textContent = en.fromPhone(batch.images.length, batch.phoneName);
  const when = document.createElement("span");
  when.textContent = relativeTime(batch.receivedAt);
  heading.append(title, when);
  const picture = document.createElement("img");
  picture.className = "hero";
  picture.alt = en.image;
  picture.src = image ? `data:image/png;base64,${image.pngBase64}` : "";
  const thumbs = document.createElement("div");
  thumbs.className = "thumbs";
  batch.images.forEach((item, index) => {
    thumbs.append(thumb(item, index === imageIndex, () => onSelect(index)));
  });
  const row = document.createElement("div");
  row.className = "actions";
  row.append(
    actionButton("primary", en.copyNumber(imageIndex + 1), "C", () => {
      if (image) {
        void api.copyHistoryImage(image.id);
      }
    }),
    actionButton("", en.open, "O", () => {
      if (image) {
        void api.openHistoryImage(image.id);
      }
    }),
    actionButton("", en.delete, "Del", onDelete),
  );
  wrap.append(heading, picture, thumbs, row);
  return wrap;
}

function earlierRow(batch: HistoryBatch, onOpen: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "earlier-row";
  const preview = batch.images[0];
  if (preview) {
    const img = document.createElement("img");
    img.alt = en.image;
    img.src = `data:image/png;base64,${preview.pngBase64}`;
    button.append(img);
  }
  const title = document.createElement("span");
  title.textContent = en.fromPhone(batch.images.length, batch.phoneName);
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = relativeTime(batch.receivedAt);
  button.append(title, when);
  button.addEventListener("click", onOpen);
  return button;
}

function actionButton(className: string, label: string, key: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  if (className) {
    button.className = className;
  }
  const text = document.createElement("span");
  text.textContent = label;
  const hint = document.createElement("kbd");
  hint.textContent = key;
  button.append(text, hint);
  button.addEventListener("click", onClick);
  return button;
}

function relativeTime(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {
    return en.justNow;
  }
  if (minutes < 60) {
    return en.minutesAgo(minutes);
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return en.hoursAgo(hours);
  }
  return en.daysAgo(Math.round(hours / 24));
}

function thumb(image: HistoryImage, selected: boolean, onSelect: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = selected ? "thumb selected" : "thumb";
  const img = document.createElement("img");
  img.alt = en.image;
  img.src = `data:image/png;base64,${image.pngBase64}`;
  button.append(img);
  button.addEventListener("click", onSelect);
  return button;
}

function pendingDialog(name: string, decide: (accepted: boolean) => Promise<void>): HTMLElement {
  const dialog = document.createElement("div");
  dialog.className = "dialog";
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
