import { en } from "../../shared/locales/en";
import { markColors, type EditorTool, type Mark } from "../../shared/tools";

export type Draft = {
  id: string;
  pngBase64: string;
  marks: Mark[];
};

type Options = {
  pcName: string;
  online: boolean;
  drafts: Draft[];
  onClose: () => void;
  onSwitch: () => void;
  onSend: (images: string[]) => Promise<void>;
};

export function mountEditor(root: HTMLElement, options: Options): void {
  let tool: EditorTool = "arrow";
  let color: string = markColors[0];
  let selected = 0;
  let dragging = false;
  let origin = { x: 0, y: 0 };
  let current: Mark | null = null;
  let viewRect = { x: 0, y: 0, w: 1, h: 1 };
  let image = new Image();

  const shell = document.createElement("section");
  shell.className = "panel editor";
  shell.innerHTML = `
    <header class="bar">
      <button type="button" data-action="close">${en.close}</button>
      <button type="button" class="pc" data-action="switch"><span class="dot"></span><span data-pc></span></button>
      <button type="button" class="primary" data-action="send"></button>
    </header>
    <canvas class="stage"></canvas>
    <div class="thumbs" data-thumbs></div>
    <label class="text-row"><input data-text type="text" maxlength="80" placeholder="${en.textPlaceholder}" /></label>
    <div class="colors" data-colors></div>
    <div class="tools" data-tools></div>
    <p class="status" data-status></p>
  `;
  root.replaceChildren(shell);

  const canvas = shell.querySelector("canvas");
  const thumbs = shell.querySelector<HTMLElement>("[data-thumbs]");
  const colors = shell.querySelector<HTMLElement>("[data-colors]");
  const tools = shell.querySelector<HTMLElement>("[data-tools]");
  const status = shell.querySelector<HTMLElement>("[data-status]");
  const textInput = shell.querySelector<HTMLInputElement>("[data-text]");
  const sendButton = shell.querySelector<HTMLButtonElement>("[data-action=send]");
  const pcButton = shell.querySelector<HTMLElement>("[data-pc]");
  const dot = shell.querySelector<HTMLElement>(".dot");
  if (!canvas || !thumbs || !colors || !tools || !status || !textInput || !sendButton || !pcButton || !dot) {
    return;
  }
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const stage = canvas;
  const ctx = context;
  const thumbRow = thumbs;
  const colorRow = colors;
  const toolRow = tools;
  const statusLine = status;
  const textField = textInput;
  const sendControl = sendButton;
  const pcLabel = pcButton;
  const onlineDot = dot;

  const toolButtons: Array<[EditorTool | "undo", string]> = [
    ["crop", en.crop],
    ["arrow", en.arrow],
    ["text", en.text],
    ["blur", en.blur],
    ["undo", en.undo],
  ];
  for (const [name, label] of toolButtons) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.tool = name;
    toolRow.append(button);
  }
  const colorLabels = [en.red, en.white, en.black];
  markColors.forEach((value, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "swatch";
    button.style.background = value;
    button.title = colorLabels[index] ?? value;
    button.dataset.color = value;
    colorRow.append(button);
  });

  function draft(): Draft {
    return options.drafts[selected] ?? options.drafts[0];
  }

  function paint(): void {
    const item = draft();
    if (!item) {
      return;
    }
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    stage.width = width;
    stage.height = height;
    ctx.clearRect(0, 0, width, height);
    if (!image.naturalWidth) {
      return;
    }
    const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
    const drawW = image.naturalWidth * scale;
    const drawH = image.naturalHeight * scale;
    viewRect = { x: (width - drawW) / 2, y: (height - drawH) / 2, w: drawW, h: drawH };
    ctx.drawImage(image, viewRect.x, viewRect.y, viewRect.w, viewRect.h);
    const marks = current ? [...item.marks, current] : item.marks;
    for (const mark of marks) {
      drawMark(ctx, mark, viewRect, image);
    }
  }

  function renderChrome(): void {
    pcLabel.textContent = options.pcName;
    onlineDot.classList.toggle("on", options.online);
    sendControl.textContent = en.sendCount(options.drafts.length);
    sendControl.disabled = options.drafts.length === 0;
    textField.parentElement?.classList.toggle("show", tool === "text");
    colorRow.classList.toggle("show", tool === "arrow" || tool === "text");
    for (const button of toolRow.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.tool === tool);
      if (button.dataset.tool === "undo") {
        button.disabled = (draft()?.marks.length ?? 0) === 0;
      }
    }
    for (const button of colorRow.querySelectorAll("button")) {
      button.classList.toggle("active", button.dataset.color === color);
    }
    thumbRow.replaceChildren();
    options.drafts.forEach((item, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "thumb";
      if (index === selected) {
        button.classList.add("selected");
      }
      if (item.marks.length > 0) {
        button.classList.add("marked");
      }
      const img = document.createElement("img");
      img.src = `data:image/png;base64,${item.pngBase64}`;
      img.alt = en.image;
      button.append(img);
      let timer = 0;
      button.addEventListener("pointerdown", () => {
        timer = window.setTimeout(() => {
          options.drafts.splice(index, 1);
          selected = Math.max(0, Math.min(selected, options.drafts.length - 1));
          loadSelected();
          renderChrome();
        }, 500);
      });
      button.addEventListener("pointerup", () => window.clearTimeout(timer));
      button.addEventListener("pointerleave", () => window.clearTimeout(timer));
      button.addEventListener("click", () => {
        selected = index;
        loadSelected();
        renderChrome();
      });
      thumbRow.append(button);
    });
  }

  function loadSelected(): void {
    const item = draft();
    image = new Image();
    if (!item) {
      paint();
      return;
    }
    image.onload = () => paint();
    image.src = `data:image/png;base64,${item.pngBase64}`;
  }

  function point(event: PointerEvent): { x: number; y: number } | null {
    const bounds = stage.getBoundingClientRect();
    const x = (event.clientX - bounds.left - viewRect.x) / viewRect.w;
    const y = (event.clientY - bounds.top - viewRect.y) / viewRect.h;
    if (x < 0 || y < 0 || x > 1 || y > 1) {
      return null;
    }
    return { x, y };
  }

  stage.addEventListener("pointerdown", (event) => {
    const item = draft();
    const start = point(event);
    if (!item || !start) {
      return;
    }
    if (tool === "text") {
      const value = textField.value.trim();
      if (!value) {
        return;
      }
      item.marks.push({ tool: "text", x: start.x, y: start.y, text: value, color });
      renderChrome();
      paint();
      return;
    }
    dragging = true;
    origin = start;
    stage.setPointerCapture(event.pointerId);
  });

  stage.addEventListener("pointermove", (event) => {
    if (!dragging) {
      return;
    }
    const end = point(event);
    if (!end) {
      return;
    }
    current = markFromDrag(tool, origin, end, color);
    paint();
  });

  stage.addEventListener("pointerup", (event) => {
    if (!dragging) {
      return;
    }
    dragging = false;
    const item = draft();
    const end = point(event) ?? origin;
    const mark = markFromDrag(tool, origin, end, color);
    current = null;
    if (item && markHasSize(mark)) {
      if (mark.tool === "crop") {
        item.marks = item.marks.filter((existing) => existing.tool !== "crop");
      }
      item.marks.push(mark);
    }
    renderChrome();
    paint();
  });

  shell.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const action = target.closest<HTMLElement>("[data-action]")?.dataset.action;
    if (action === "close") {
      options.onClose();
    }
    if (action === "switch") {
      if (options.drafts.some((item) => item.marks.length > 0) && !window.confirm(en.switchComputer)) {
        return;
      }
      options.onSwitch();
    }
    if (action === "send") {
      void send();
    }
    const toolName = target.closest<HTMLElement>("[data-tool]")?.dataset.tool;
    if (toolName === "undo") {
      draft()?.marks.pop();
      renderChrome();
      paint();
    } else if (toolName === "crop" || toolName === "arrow" || toolName === "text" || toolName === "blur") {
      tool = toolName;
      renderChrome();
    }
    const nextColor = target.closest<HTMLElement>("[data-color]")?.dataset.color;
    if (nextColor) {
      color = nextColor;
      renderChrome();
    }
  });

  async function send(): Promise<void> {
    sendControl.disabled = true;
    statusLine.textContent = "";
    try {
      const images: string[] = [];
      for (const item of options.drafts) {
        images.push(await exportDraft(item));
      }
      await options.onSend(images);
    } catch (error) {
      statusLine.textContent = error instanceof Error ? error.message : en.didNotReceive(options.pcName);
      sendControl.disabled = false;
    }
  }

  loadSelected();
  renderChrome();
}

function markFromDrag(
  tool: EditorTool,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
): Mark {
  if (tool === "arrow") {
    return { tool: "arrow", x1: start.x, y1: start.y, x2: end.x, y2: end.y, color };
  }
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (tool === "blur") {
    return { tool: "blur", x, y, w, h };
  }
  return { tool: "crop", x, y, w, h };
}

function markHasSize(mark: Mark): boolean {
  if (mark.tool === "arrow") {
    return Math.hypot(mark.x2 - mark.x1, mark.y2 - mark.y1) > 0.01;
  }
  if (mark.tool === "text") {
    return mark.text.length > 0;
  }
  return mark.w > 0.01 && mark.h > 0.01;
}

function drawMark(
  context: CanvasRenderingContext2D,
  mark: Mark,
  view: { x: number; y: number; w: number; h: number },
  image: HTMLImageElement,
): void {
  if (mark.tool === "crop") {
    context.strokeStyle = "#6ea8fe";
    context.lineWidth = 2;
    context.strokeRect(view.x + mark.x * view.w, view.y + mark.y * view.h, mark.w * view.w, mark.h * view.h);
    return;
  }
  if (mark.tool === "arrow") {
    drawArrow(context, view, mark);
    return;
  }
  if (mark.tool === "text") {
    context.fillStyle = mark.color;
    context.font = `${Math.max(14, view.w * 0.045)}px sans-serif`;
    context.fillText(mark.text, view.x + mark.x * view.w, view.y + mark.y * view.h);
    return;
  }
  const sx = mark.x * image.naturalWidth;
  const sy = mark.y * image.naturalHeight;
  const sw = Math.max(1, mark.w * image.naturalWidth);
  const sh = Math.max(1, mark.h * image.naturalHeight);
  const dx = view.x + mark.x * view.w;
  const dy = view.y + mark.y * view.h;
  const dw = mark.w * view.w;
  const dh = mark.h * view.h;
  const sample = document.createElement("canvas");
  sample.width = Math.max(1, Math.round(dw / 12));
  sample.height = Math.max(1, Math.round(dh / 12));
  const sampleContext = sample.getContext("2d");
  if (!sampleContext) {
    return;
  }
  sampleContext.drawImage(image, sx, sy, sw, sh, 0, 0, sample.width, sample.height);
  context.imageSmoothingEnabled = false;
  context.drawImage(sample, dx, dy, dw, dh);
}

function drawArrow(
  context: CanvasRenderingContext2D,
  view: { x: number; y: number; w: number; h: number },
  mark: Extract<Mark, { tool: "arrow" }>,
): void {
  const x1 = view.x + mark.x1 * view.w;
  const y1 = view.y + mark.y1 * view.h;
  const x2 = view.x + mark.x2 * view.w;
  const y2 = view.y + mark.y2 * view.h;
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
  const angle = Math.atan2(y2 - y1, x2 - x1);
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(x2 - 12 * Math.cos(angle - 0.4), y2 - 12 * Math.sin(angle - 0.4));
  context.lineTo(x2 - 12 * Math.cos(angle + 0.4), y2 - 12 * Math.sin(angle + 0.4));
  context.closePath();
  context.fill();
}

async function exportDraft(item: Draft): Promise<string> {
  const image = await loadImage(`data:image/png;base64,${item.pngBase64}`);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return item.pngBase64;
  }
  context.drawImage(image, 0, 0);
  const view = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  for (const mark of item.marks) {
    if (mark.tool !== "crop") {
      drawMark(context, mark, view, image);
    }
  }
  const crop = [...item.marks].reverse().find((mark) => mark.tool === "crop");
  const output = crop && crop.tool === "crop" ? cropCanvas(canvas, crop) : canvas;
  const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
  if (!blob) {
    return item.pngBase64;
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary);
}

function cropCanvas(source: HTMLCanvasElement, crop: Extract<Mark, { tool: "crop" }>): HTMLCanvasElement {
  const output = document.createElement("canvas");
  const sx = crop.x * source.width;
  const sy = crop.y * source.height;
  const sw = Math.max(1, crop.w * source.width);
  const sh = Math.max(1, crop.h * source.height);
  output.width = Math.max(1, Math.round(sw));
  output.height = Math.max(1, Math.round(sh));
  output.getContext("2d")?.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}
