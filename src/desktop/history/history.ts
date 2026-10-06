import { api, type HistoryBatch, type HistoryImage, type HostStatus } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { mountPhones } from "../devices/devices";
import { mountSettings } from "../settings/settings";

export async function mountDesktop(root: HTMLElement): Promise<void> {
  let batches = await api.listHistory();
  let status = await api.hostStatus();
  let batchIndex = 0;
  let imageIndex = 0;
  let showQr = status.trustedCount === 0;
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
      <header class="bar">
        <strong>${en.ready}</strong>
        <button type="button" data-action="pair">${en.pairPhone}</button>
        <button type="button" data-action="phones">${en.phones}</button>
      </header>
      <div data-body></div>
      <footer class="foot">
        <button type="button" data-action="retention"></button>
        <button type="button" data-action="delete">${en.deleteAll}</button>
      </footer>
    `;
    root.replaceChildren(shell);
    const body = shell.querySelector<HTMLElement>("[data-body]");
    const retention = shell.querySelector<HTMLButtonElement>("[data-action=retention]");
    if (!body || !retention) {
      return;
    }
    retention.textContent = en.deletesAfter(status.retentionDays);
    if (showQr || status.trustedCount === 0) {
      body.append(qrBlock(status));
    }
    if (batches.length === 0) {
      const empty = document.createElement("p");
      empty.className = "status show";
      empty.textContent = en.emptyHistory;
      body.append(empty);
    } else {
      body.append(latest(batches[batchIndex] ?? batches[0], imageIndex, (next) => {
        imageIndex = next;
        paint();
      }));
      batches.forEach((batch, index) => {
        if (index === batchIndex) {
          return;
        }
        const row = document.createElement("button");
        row.type = "button";
        row.className = "line";
        const when = new Date(batch.receivedAt).toLocaleString();
        row.textContent = `${en.fromPhone(batch.images.length, batch.phoneName)} · ${when}`;
        row.addEventListener("click", () => {
          batchIndex = index;
          imageIndex = 0;
          paint();
        });
        body.append(row);
      });
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
    shell.querySelector("[data-action=pair]")?.addEventListener("click", () => {
      showQr = !showQr;
      paint();
    });
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
  }

  window.addEventListener("keydown", onKey);
  paint();
  root.addEventListener("fast-share-unmount", () => {
    window.removeEventListener("keydown", onKey);
    void unlisten();
  }, { once: true });
}

function qrBlock(status: HostStatus): HTMLElement {
  const block = document.createElement("div");
  block.className = "qr";
  const image = document.createElement("img");
  image.alt = en.pairPhone;
  image.src = `data:image/png;base64,${status.qrPngBase64}`;
  const caption = document.createElement("p");
  caption.textContent = status.pcName;
  block.append(image, caption);
  return block;
}

function latest(
  batch: HistoryBatch,
  imageIndex: number,
  onSelect: (index: number) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "latest";
  const image = batch.images[imageIndex] ?? batch.images[0];
  const heading = document.createElement("p");
  heading.textContent = `${batch.phoneName} · ${new Date(batch.receivedAt).toLocaleString()}`;
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
  row.className = "row";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.textContent = en.copy;
  copy.addEventListener("click", () => {
    if (image) {
      void api.copyHistoryImage(image.id);
    }
  });
  const open = document.createElement("button");
  open.type = "button";
  open.textContent = en.open;
  open.addEventListener("click", () => {
    if (image) {
      void api.openHistoryImage(image.id);
    }
  });
  row.append(copy, open);
  wrap.append(heading, picture, thumbs, row);
  return wrap;
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
