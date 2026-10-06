import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { mountDevices } from "../devices/devices";
import { mountEditor, type Draft } from "../editor/editor";

export async function mountPhone(root: HTMLElement): Promise<void> {
  const shared = await api.takeSharedImages();
  if (shared.length === 0) {
    await mountDevices(root, () => {
      void mountPhone(root);
    });
    return;
  }
  const drafts: Draft[] = shared.map((pngBase64, index) => ({
    id: `draft-${index}`,
    pngBase64,
    marks: [],
  }));
  await chooseDestination(root, drafts);
}

async function chooseDestination(root: HTMLElement, drafts: Draft[]): Promise<void> {
  const destinations = await api.discoverDestinations();
  const online = destinations.filter((pc) => pc.online);
  if (online.length === 0) {
    showOffline(root, drafts);
    return;
  }
  if (online.length === 1) {
    openEditor(root, drafts, online[0], destinations);
    return;
  }
  showSheet(root, drafts, online, destinations);
}

function showSheet(root: HTMLElement, drafts: Draft[], online: Destination[], all: Destination[]): void {
  const shell = document.createElement("section");
  shell.className = "panel phone";
  shell.innerHTML = `<header class="bar"><h1>${en.sendTo}</h1></header><div class="list" data-list></div>`;
  root.replaceChildren(shell);
  const list = shell.querySelector<HTMLElement>("[data-list]");
  if (!list) {
    return;
  }
  online.forEach((pc, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = index === 0 ? "line selected" : "line";
    button.textContent = pc.name;
    button.addEventListener("click", () => openEditor(root, drafts, pc, all));
    list.append(button);
  });
}

function showOffline(root: HTMLElement, drafts: Draft[]): void {
  const shell = document.createElement("section");
  shell.className = "panel phone";
  shell.innerHTML = `
    <p class="status show">${en.offline}</p>
    <div class="row">
      <button type="button" data-action="retry">${en.retry}</button>
      <button type="button" class="primary" data-action="scan">${en.scanQr}</button>
    </div>
  `;
  root.replaceChildren(shell);
  shell.querySelector("[data-action=retry]")?.addEventListener("click", () => {
    void chooseDestination(root, drafts);
  });
  shell.querySelector("[data-action=scan]")?.addEventListener("click", () => {
    void mountDevices(root, () => {
      void chooseDestination(root, drafts);
    });
  });
}

function openEditor(root: HTMLElement, drafts: Draft[], pc: Destination, all: Destination[]): void {
  mountEditor(root, {
    pcName: pc.name,
    online: pc.online,
    drafts,
    onClose: () => {
      void mountDevices(root, () => {
        void mountPhone(root);
      });
    },
    onSwitch: () => showSheet(root, drafts, all.filter((item) => item.online), all),
    onSend: async (images) => {
      try {
        await api.sendBatch(pc.pcId, images);
        const shell = document.createElement("section");
        shell.className = "panel";
        const message = document.createElement("p");
        message.className = "status show";
        message.textContent = images.length === 1 ? `${en.sentTo(pc.name)} ${en.pasteReady}` : en.sentTo(pc.name);
        shell.append(message);
        root.replaceChildren(shell);
      } catch {
        throw new Error(en.didNotReceive(pc.name));
      }
    },
  });
}
