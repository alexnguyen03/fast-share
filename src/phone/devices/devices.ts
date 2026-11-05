import { api, type Destination, type NearbyPc, type PairResult } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { errorText, latestNote, logText, note } from "../log";

export async function mountDevices(
  root: HTMLElement,
  onPaired?: () => void,
  onPickImages?: (imagesBase64: string[]) => void,
): Promise<void> {
  let scanning = false;
  let cancelScan: (() => Promise<void>) | null = null;
  let codeValue = "";
  let addressValue = "";
  let nearbyList: NearbyPc[] = [];

  const shell = document.createElement("section");
  shell.className = "panel phone";
  root.replaceChildren(shell);

  function renderLog(parent: HTMLElement): void {
    const log = document.createElement("pre");
    log.className = "phone-log";
    log.textContent = logText();
    parent.append(log);
  }

  async function refreshNearby(): Promise<void> {
    try {
      nearbyList = await api.discoverNearbyPcs();
    } catch {
      nearbyList = [];
    }
    if (!scanning && shell.isConnected) {
      await renderHome();
    }
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

    const codeForm = document.createElement("form");
    codeForm.className = "form code-form";
    const codeRow = document.createElement("div");
    codeRow.className = "row";
    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.inputMode = "numeric";
    codeInput.maxLength = 6;
    codeInput.placeholder = en.pairCodePlaceholder;
    codeInput.value = codeValue;
    codeInput.addEventListener("input", () => {
      codeValue = codeInput.value.replace(/\D+/g, "").slice(0, 6);
      codeInput.value = codeValue;
    });
    const codeSubmit = document.createElement("button");
    codeSubmit.type = "submit";
    codeSubmit.className = "primary";
    codeSubmit.textContent = en.pairWithCodeButton;
    codeRow.append(codeInput, codeSubmit);

    const addrInput = document.createElement("input");
    addrInput.type = "text";
    addrInput.placeholder = en.lanAddressPlaceholder;
    addrInput.value = addressValue;
    addrInput.setAttribute("aria-label", en.lanAddressLabel);
    addrInput.addEventListener("input", () => {
      addressValue = addrInput.value;
    });
    codeForm.append(codeRow, addrInput);
    codeForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (codeValue.length !== 6) {
        return;
      }
      void submitCode(codeValue, addressValue);
    });

    const nearbyWrap = document.createElement("div");
    nearbyWrap.className = "list";
    const nearbyBar = document.createElement("div");
    nearbyBar.className = "bar";
    const nearbyLabel = document.createElement("span");
    nearbyLabel.className = "when";
    nearbyLabel.textContent = en.nearbyOnWifi;
    const nearbyRefresh = document.createElement("button");
    nearbyRefresh.type = "button";
    nearbyRefresh.textContent = en.refreshNearby;
    nearbyRefresh.addEventListener("click", () => {
      void refreshNearby();
    });
    nearbyBar.append(nearbyLabel, nearbyRefresh);
    nearbyWrap.append(nearbyBar);
    for (const item of nearbyList) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "line";
      const label = document.createElement("span");
      label.textContent = `${item.name} (${item.host}:${item.port})`;
      btn.append(label);
      btn.addEventListener("click", () => {
        addressValue = `${item.host}:${item.port}`;
        addrInput.value = addressValue;
        codeInput.focus();
      });
      nearbyWrap.append(btn);
    }

    const list = document.createElement("div");
    list.className = "list";
    for (const pc of known) {
      list.append(pcRow(pc, () => {
        void renderHome();
      }));
    }
    if (known.length > 0 && onPickImages) {
      const fileInput = document.createElement("input");
      fileInput.type = "file";
      fileInput.accept = "image/*";
      fileInput.multiple = true;
      fileInput.className = "file";
      const pickBtn = document.createElement("button");
      pickBtn.type = "button";
      pickBtn.className = "primary scan";
      pickBtn.textContent = en.pickImages;
      pickBtn.addEventListener("click", () => {
        fileInput.click();
      });
      fileInput.addEventListener("change", () => {
        const files = Array.from(fileInput.files ?? []);
        if (files.length === 0) {
          return;
        }
        void filesToBase64(files).then((encoded) => {
          if (encoded.length > 0) {
            onPickImages(encoded);
          }
        });
      });
      shell.append(title, notice, pickBtn, fileInput, scan, codeForm, nearbyWrap, list);
    } else {
      shell.append(title, notice, scan, codeForm, nearbyWrap, list);
    }
    renderLog(shell);
  }

  async function submitCode(code: string, address: string): Promise<void> {
    note(en.qrRead);
    await renderHome();
    const paired = await finishPair(() => api.pairWithCode(code, address), async () => {
      await renderHome();
    });
    if (paired && onPaired) {
      onPaired();
    }
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
      const paired = await finishPair(() => api.pairWithQr(scanned.content), async () => {
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
  void refreshNearby();
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

async function finishPair(
  action: () => Promise<PairResult>,
  refresh: () => Promise<void>,
): Promise<boolean> {
  let result;
  try {
    result = await action();
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
  if (result.status === "needs_forget") {
    note(en.needsForgetOnComputer);
    await refresh();
    return false;
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

async function filesToBase64(files: File[]): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("file"));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    if (comma >= 0) {
      results.push(dataUrl.slice(comma + 1));
    }
  }
  return results;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
