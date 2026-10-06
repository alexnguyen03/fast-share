import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";

export async function mountDevices(root: HTMLElement, onReady: () => void): Promise<void> {
  const known = await api.listKnownPcs();
  const shell = document.createElement("section");
  shell.className = "panel phone";
  shell.innerHTML = `
    <header class="bar"><h1>${en.knownComputers}</h1></header>
    <div class="list" data-list></div>
    <p class="status show" data-status></p>
    <button type="button" class="primary scan" data-action="scan">${en.scanQr}</button>
    <video data-camera playsinline></video>
    <label class="file">${en.chooseQr}<input data-file type="file" accept="image/*" /></label>
  `;
  root.replaceChildren(shell);
  const list = shell.querySelector<HTMLElement>("[data-list]");
  const status = shell.querySelector<HTMLElement>("[data-status]");
  const video = shell.querySelector<HTMLVideoElement>("[data-camera]");
  const file = shell.querySelector<HTMLInputElement>("[data-file]");
  if (!list || !status || !video || !file) {
    return;
  }
  if (known.length === 0) {
    status.textContent = en.noComputers;
  }
  renderPcs(list, known, status);
  shell.querySelector("[data-action=scan]")?.addEventListener("click", () => {
    void startScan(video, file, status, onReady);
  });
}

function renderPcs(list: HTMLElement, pcs: Destination[], status: HTMLElement): void {
  list.replaceChildren();
  for (const pc of pcs) {
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
      void api.forgetPc(pc.pcId).then(async () => {
        renderPcs(list, await api.listKnownPcs(), status);
      });
    });
    row.append(name, forget);
    list.append(row);
  }
}

function runningInApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function startScan(
  video: HTMLVideoElement,
  file: HTMLInputElement,
  status: HTMLElement,
  onReady: () => void,
): Promise<void> {
  if (runningInApp()) {
    await scanWithDeviceCamera(status, onReady);
    return;
  }
  file.parentElement?.classList.add("show");
  file.onchange = () => {
    const image = file.files?.[0];
    if (!image) {
      return;
    }
    void decodeFile(image, status, onReady);
  };
  if (!navigator.mediaDevices?.getUserMedia || !("BarcodeDetector" in window)) {
    status.textContent = en.cameraUnavailable;
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    video.srcObject = stream;
    video.classList.add("show");
    await video.play();
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const tick = async () => {
      if (!video.srcObject) {
        return;
      }
      const codes = await detector.detect(video);
      const value = codes[0]?.rawValue;
      if (value) {
        stream.getTracks().forEach((track) => track.stop());
        video.srcObject = null;
        await pairPayload(value, status, onReady);
        return;
      }
      window.setTimeout(() => void tick(), 400);
    };
    void tick();
  } catch {
    status.textContent = en.cameraUnavailable;
  }
}

async function scanWithDeviceCamera(status: HTMLElement, onReady: () => void): Promise<void> {
  const previous = status.textContent ?? "";
  status.textContent = en.scanning;
  try {
    const { scan, Format } = await import("@tauri-apps/plugin-barcode-scanner");
    const scanned = await scan({ formats: [Format.QRCode] });
    await pairPayload(scanned.content, status, onReady);
  } catch {
    status.textContent = previous;
  }
}

async function decodeFile(file: File, status: HTMLElement, onReady: () => void): Promise<void> {
  if (!("BarcodeDetector" in window)) {
    status.textContent = en.cameraUnavailable;
    return;
  }
  const bitmap = await createImageBitmap(file);
  const detector = new BarcodeDetector({ formats: ["qr_code"] });
  const codes = await detector.detect(bitmap);
  const value = codes[0]?.rawValue;
  if (!value) {
    status.textContent = en.cameraUnavailable;
    return;
  }
  await pairPayload(value, status, onReady);
}

async function pairPayload(payload: string, status: HTMLElement, onReady: () => void): Promise<void> {
  const result = await api.pairWithQr(payload);
  if (result.status === "trusted") {
    onReady();
    return;
  }
  if (result.status === "rejected") {
    status.textContent = en.rejected;
    return;
  }
  status.textContent = en.waiting;
  const known = await api.listKnownPcs();
  const pc = known[0];
  if (!pc) {
    return;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await wait(1000);
    const next = await api.pollPair(pc.pcId);
    if (next.status === "trusted") {
      onReady();
      return;
    }
    if (next.status === "rejected") {
      status.textContent = en.rejected;
      return;
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

declare class BarcodeDetector {
  constructor(options?: { formats: string[] });
  detect(source: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
