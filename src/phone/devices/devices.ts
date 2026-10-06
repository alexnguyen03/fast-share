import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { errorText, latestNote, logText, note } from "../log";

export async function mountDevices(root: HTMLElement, onPaired?: () => void): Promise<void> {
  let scanning = false;
  let cancelScan: (() => Promise<void>) | null = null;

  const shell = document.createElement("section");
  shell.className = "panel phone";
  root.replaceChildren(shell);

  function renderLog(parent: HTMLElement): void {
    const log = document.createElement("pre");
    log.className = "phone-log";
    log.textContent = logText();
    parent.append(log);
  }

  async function renderHome(): Promise<void> {
    scanning = false;
    document.documentElement.classList.remove("camera-open");
    const known = await api.listKnownPcs();
    shell.className = "panel phone";
    shell.replaceChildren();
    const title = document.createElement("h1");
    title.textContent = en.knownComputers;
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.textContent = latestNote() || (known.length === 0 ? en.noComputers : "");
    const scan = document.createElement("button");
    scan.type = "button";
    scan.className = "primary scan";
    scan.textContent = en.scanQr;
    scan.addEventListener("click", () => {
      void startScan();
    });
    const list = document.createElement("div");
    list.className = "list";
    for (const pc of known) {
      list.append(pcRow(pc, () => {
        void renderHome();
      }));
    }
    shell.append(title, notice, scan, list);
    renderLog(shell);
  }

  function renderScan(): void {
    scanning = true;
    document.documentElement.classList.add("camera-open");
    shell.className = "panel phone";
    shell.replaceChildren();
    const title = document.createElement("h1");
    title.textContent = en.scanQr;
    const hole = document.createElement("div");
    hole.className = "scan-hole";
    const notice = document.createElement("p");
    notice.className = "notice";
    notice.textContent = en.scanning;
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = en.cancel;
    cancel.addEventListener("click", () => {
      void cancelScan?.();
    });
    shell.append(title, hole, notice, cancel);
    renderLog(shell);
  }

  async function startScan(): Promise<void> {
    if (scanning) {
      return;
    }
    renderScan();
    let leave = false;
    if (!runningInApp()) {
      note(en.cameraUnavailable);
      const notice = shell.querySelector(".notice");
      if (notice) {
        notice.textContent = en.cameraUnavailable;
      }
      const log = shell.querySelector(".phone-log");
      if (log) {
        log.textContent = logText();
      }
      cancelScan = async () => {
        await renderHome();
      };
      return;
    }
    try {
      const scanner = await import("@tauri-apps/plugin-barcode-scanner");
      cancelScan = () => scanner.cancel();
      const permission = await scanner.requestPermissions();
      if (permission !== "granted") {
        note(en.cameraDenied);
        return;
      }
      note(en.scanning);
      const scanned = await scanner.scan({
        windowed: true,
        cameraDirection: "back",
        formats: [scanner.Format.QRCode],
      });
      document.documentElement.classList.remove("camera-open");
      note(en.qrRead);
      await renderHome();
      const paired = await finishPair(scanned.content, async () => {
        await renderHome();
      });
      if (paired && onPaired) {
        leave = true;
        onPaired();
      }
    } catch (error) {
      const message = errorText(error);
      note(message === "cancelled" ? en.scanCancelled : message);
    } finally {
      cancelScan = null;
      if (leave) {
        document.documentElement.classList.remove("camera-open");
        return;
      }
      if (shell.isConnected) {
        await renderHome();
      }
    }
  }

  await renderHome();
}

function pcRow(pc: Destination, refresh: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "line";
  const name = document.createElement("span");
  name.textContent = pc.name;
  const forget = document.createElement("button");
  forget.type = "button";
  forget.textContent = en.forget;
  forget.addEventListener("click", () => {
    if (!window.confirm(en.forgetComputer(pc.name))) {
      return;
    }
    void api.forgetPc(pc.pcId).then(() => {
      note(en.forgotComputer(pc.name));
      refresh();
    });
  });
  row.append(name, forget);
  return row;
}

async function finishPair(payload: string, refresh: () => Promise<void>): Promise<boolean> {
  let result;
  try {
    result = await api.pairWithQr(payload);
  } catch (error) {
    note(errorText(error));
    await refresh();
    return false;
  }
  const known = await api.listKnownPcs();
  const pc = known[0];
  if (result.status === "trusted") {
    note(en.pairedWith(pc?.name ?? en.knownComputers));
    await refresh();
    return true;
  }
  if (result.status === "rejected") {
    note(en.rejected);
    await refresh();
    return false;
  }
  note(en.waiting);
  await refresh();
  if (!pc) {
    note(en.pairFailed);
    await refresh();
    return false;
  }
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await wait(1000);
    try {
      const next = await api.pollPair(pc.pcId);
      if (next.status === "trusted") {
        note(en.pairedWith(pc.name));
        await refresh();
        return true;
      }
      if (next.status === "rejected") {
        note(en.rejected);
        await refresh();
        return false;
      }
    } catch (error) {
      note(errorText(error));
      await refresh();
      return false;
    }
    if (attempt % 5 === 0) {
      note(en.waiting);
      await refresh();
    }
  }
  note(en.timedOut);
  await refresh();
  return false;
}

function runningInApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
