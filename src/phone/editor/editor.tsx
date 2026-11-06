import * as React from "react";
import { en } from "../../shared/locales/en";
import { markColors, type EditorTool, type Mark } from "../../shared/tools";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../shared/ui/alert-dialog";
import { Button } from "../../shared/ui/button";
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";

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
  onSend: (batchId: string, images: string[]) => Promise<void>;
};

const icons = {
  close: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 7l10 10M17 7L7 17" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 10l5 5 5-5" />
    </svg>
  ),
  send: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h12M13 7l5 5-5 5" />
    </svg>
  ),
  crop: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 3H4v4M16 3h4v4M8 21H4v-4M16 21h4v-4" />
    </svg>
  ),
  arrow: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 17L17 7M10 7h7v7" />
    </svg>
  ),
  blur: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <circle cx="9" cy="9" r="1" />
      <circle cx="12" cy="9" r="1" />
      <circle cx="15" cy="9" r="1" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
      <circle cx="9" cy="15" r="1" />
      <circle cx="12" cy="15" r="1" />
      <circle cx="15" cy="15" r="1" />
    </svg>
  ),
  text: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6h12M12 6v12" />
    </svg>
  ),
  undo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 8H5V5" />
      <path d="M5 8a7 7 0 1 1-1 4" />
    </svg>
  ),
};

function PhoneEditorScreen({ options }: { options: Options }): React.JSX.Element {
  const [tool, setTool] = React.useState<EditorTool>("arrow");
  const [color, setColor] = React.useState<string>(markColors[0]);
  const [selected, setSelected] = React.useState<number>(0);
  const [textValue, setTextValue] = React.useState<string>("");
  const [sending, setSending] = React.useState<boolean>(false);
  const [statusLine, setStatusLine] = React.useState<string>("");
  const [switchConfirmOpen, setSwitchConfirmOpen] = React.useState<boolean>(false);
  const [, forceRender] = React.useReducer((x: number) => x + 1, 0);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stageBoxRef = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement>(new Image());
  const viewRectRef = React.useRef({ x: 0, y: 0, w: 1, h: 1 });
  const draggingRef = React.useRef(false);
  const originRef = React.useRef({ x: 0, y: 0 });
  const currentMarkRef = React.useRef<Mark | null>(null);
  const pendingBatchIdRef = React.useRef<string | null>(null);

  const currentDraft = options.drafts[selected] ?? options.drafts[0];

  const paint = React.useCallback(() => {
    const stage = canvasRef.current;
    const box = stageBoxRef.current;
    if (!stage || !box || !currentDraft) {
      return;
    }
    const ctx = stage.getContext("2d");
    if (!ctx) {
      return;
    }
    const width = box.clientWidth;
    const height = box.clientHeight;
    if (width < 2 || height < 2) {
      return;
    }
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.width = Math.round(width);
    stage.height = Math.round(height);
    ctx.clearRect(0, 0, width, height);
    const img = imageRef.current;
    if (!img.naturalWidth) {
      return;
    }
    const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
    const drawW = img.naturalWidth * scale;
    const drawH = img.naturalHeight * scale;
    viewRectRef.current = {
      x: (width - drawW) / 2,
      y: (height - drawH) / 2,
      w: drawW,
      h: drawH,
    };
    ctx.drawImage(
      img,
      viewRectRef.current.x,
      viewRectRef.current.y,
      viewRectRef.current.w,
      viewRectRef.current.h,
    );
    const marks = currentMarkRef.current
      ? [...currentDraft.marks, currentMarkRef.current]
      : currentDraft.marks;
    for (const mark of marks) {
      drawMark(ctx, mark, viewRectRef.current, img);
    }
  }, [currentDraft]);

  React.useEffect(() => {
    const img = new Image();
    imageRef.current = img;
    if (!currentDraft) {
      paint();
      return;
    }
    img.onload = () => paint();
    img.src = `data:image/png;base64,${currentDraft.pngBase64}`;
  }, [currentDraft, paint]);

  React.useEffect(() => {
    const box = stageBoxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver(() => paint());
    observer.observe(box);
    return () => observer.disconnect();
  }, [paint]);

  function point(
    event: React.PointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number } | null {
    const stage = canvasRef.current;
    if (!stage) {
      return null;
    }
    const bounds = stage.getBoundingClientRect();
    const viewRect = viewRectRef.current;
    const x = (event.clientX - bounds.left - viewRect.x) / viewRect.w;
    const y = (event.clientY - bounds.top - viewRect.y) / viewRect.h;
    if (x < 0 || y < 0 || x > 1 || y > 1) {
      return null;
    }
    return { x, y };
  }

  async function handleSend(): Promise<void> {
    setSending(true);
    setStatusLine("");
    const batchId = pendingBatchIdRef.current ?? newBatchId();
    pendingBatchIdRef.current = batchId;
    try {
      const images: string[] = [];
      for (const item of options.drafts) {
        images.push(await exportDraft(item));
      }
      await options.onSend(batchId, images);
      pendingBatchIdRef.current = null;
    } catch (error) {
      setStatusLine(
        error instanceof Error
          ? error.message
          : en.didNotReceive(options.pcName),
      );
      setSending(false);
    }
  }

  const toolButtons: Array<[EditorTool, string]> = [
    ["crop", en.crop],
    ["arrow", en.arrow],
    ["blur", en.blur],
    ["text", en.text],
  ];
  const colorLabels = [en.red, en.white, en.black];

  return (
    <section className="panel editor">
      <header className="editor-top">
        <Button
          variant="darkSecondary"
          className="icon-btn"
          aria-label={en.close}
          onClick={options.onClose}
        >
          {icons.close}
        </Button>
        <Button
          variant="darkSecondary"
          className="dest-pill"
          onClick={() => {
            if (options.drafts.some((item) => item.marks.length > 0)) {
              setSwitchConfirmOpen(true);
              return;
            }
            options.onSwitch();
          }}
        >
          <span className={options.online ? "dot on" : "dot"} />
          <span>{en.toComputer(options.pcName)}</span>
          {icons.chevron}
        </Button>
        <Button
          variant="primaryBlue"
          className="send-pill"
          disabled={sending || options.drafts.length === 0}
          onClick={() => {
            void handleSend();
          }}
        >
          <span>{en.sendCount(options.drafts.length)}</span>
          {icons.send}
        </Button>
      </header>

      <AlertDialog
        open={switchConfirmOpen}
        onOpenChange={setSwitchConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{en.sendTo}</AlertDialogTitle>
            <AlertDialogDescription>{en.switchComputer}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSwitchConfirmOpen(false);
                options.onSwitch();
              }}
            >
              {en.sendTo}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div ref={stageBoxRef} className="editor-stage">
        <canvas
          ref={canvasRef}
          className="stage"
          onPointerDown={(event) => {
            const start = point(event);
            if (!currentDraft || !start) {
              return;
            }
            if (tool === "text") {
              const trimmed = textValue.trim();
              if (!trimmed) {
                return;
              }
              currentDraft.marks.push({
                tool: "text",
                x: start.x,
                y: start.y,
                text: trimmed,
                color,
              });
              forceRender();
              paint();
              return;
            }
            draggingRef.current = true;
            originRef.current = start;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!draggingRef.current) {
              return;
            }
            const end = point(event);
            if (!end) {
              return;
            }
            currentMarkRef.current = markFromDrag(
              tool,
              originRef.current,
              end,
              color,
            );
            paint();
          }}
          onPointerUp={(event) => {
            if (!draggingRef.current) {
              return;
            }
            draggingRef.current = false;
            const end = point(event) ?? originRef.current;
            const mark = markFromDrag(tool, originRef.current, end, color);
            currentMarkRef.current = null;
            if (currentDraft && markHasSize(mark)) {
              if (mark.tool === "crop") {
                currentDraft.marks = currentDraft.marks.filter(
                  (existing) => existing.tool !== "crop",
                );
              }
              currentDraft.marks.push(mark);
            }
            forceRender();
            paint();
          }}
        />

        <div className="tool-dock">
          {toolButtons.map(([name, label]) => (
            <Button
              key={name}
              variant="ghost"
              aria-label={label}
              className={tool === name ? "active" : ""}
              onClick={() => setTool(name)}
            >
              {icons[name]}
            </Button>
          ))}
          <span className="split" />
          <Button
            variant="ghost"
            aria-label={en.undo}
            disabled={(currentDraft?.marks.length ?? 0) === 0}
            onClick={() => {
              currentDraft?.marks.pop();
              forceRender();
              paint();
            }}
          >
            {icons.undo}
          </Button>
        </div>

        <div className="editor-extra">
          <div
            className={
              tool === "arrow" || tool === "text" ? "colors show" : "colors"
            }
          >
            {markColors.map((value, index) => (
              <Button
                key={value}
                variant="ghost"
                title={colorLabels[index] ?? value}
                style={{ background: value }}
                className={color === value ? "swatch active" : "swatch"}
                onClick={() => setColor(value)}
              />
            ))}
          </div>
          <label className={tool === "text" ? "text-row show" : "text-row"}>
            <Input
              type="text"
              maxLength={80}
              placeholder={en.textPlaceholder}
              value={textValue}
              onChange={(event) => setTextValue(event.target.value)}
            />
          </label>
        </div>
      </div>

      <footer className="editor-foot">
        <div className="thumbs">
          {options.drafts.map((item, index) => (
            <ThumbButton
              key={item.id}
              item={item}
              selected={index === selected}
              onSelect={() => setSelected(index)}
              onRemove={() => {
                options.drafts.splice(index, 1);
                setSelected((prev) =>
                  Math.max(0, Math.min(prev, options.drafts.length - 1)),
                );
                forceRender();
              }}
            />
          ))}
        </div>
        <p className="hold">{en.holdToRemove}</p>
        <p className="status">{statusLine}</p>
      </footer>
    </section>
  );
}

function ThumbButton({
  item,
  selected,
  onSelect,
  onRemove,
}: {
  item: Draft;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const timerRef = React.useRef<number>(0);
  const classes = [
    "thumb",
    selected ? "selected" : "",
    item.marks.length > 0 ? "marked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Button
      variant="ghost"
      className={classes}
      onPointerDown={() => {
        timerRef.current = window.setTimeout(onRemove, 500);
      }}
      onPointerUp={() => window.clearTimeout(timerRef.current)}
      onPointerLeave={() => window.clearTimeout(timerRef.current)}
      onClick={onSelect}
    >
      <img src={`data:image/png;base64,${item.pngBase64}`} alt={en.image} />
    </Button>
  );
}

export function mountEditor(root: HTMLElement, options: Options): void {
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(<PhoneEditorScreen options={options} />);
}

function markFromDrag(
  tool: EditorTool,
  start: { x: number; y: number },
  end: { x: number; y: number },
  color: string,
): Mark {
  if (tool === "arrow") {
    return {
      tool: "arrow",
      x1: start.x,
      y1: start.y,
      x2: end.x,
      y2: end.y,
      color,
    };
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
    context.strokeRect(
      view.x + mark.x * view.w,
      view.y + mark.y * view.h,
      mark.w * view.w,
      mark.h * view.h,
    );
    return;
  }
  if (mark.tool === "arrow") {
    drawArrow(context, view, mark);
    return;
  }
  if (mark.tool === "text") {
    context.fillStyle = mark.color;
    context.font = `${Math.max(14, view.w * 0.045)}px sans-serif`;
    context.fillText(
      mark.text,
      view.x + mark.x * view.w,
      view.y + mark.y * view.h,
    );
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
  sampleContext.drawImage(
    image,
    sx,
    sy,
    sw,
    sh,
    0,
    0,
    sample.width,
    sample.height,
  );
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
  context.lineTo(
    x2 - 12 * Math.cos(angle - 0.4),
    y2 - 12 * Math.sin(angle - 0.4),
  );
  context.lineTo(
    x2 - 12 * Math.cos(angle + 0.4),
    y2 - 12 * Math.sin(angle + 0.4),
  );
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
  const output =
    crop && crop.tool === "crop" ? cropCanvas(canvas, crop) : canvas;
  const blob = await new Promise<Blob | null>((resolve) =>
    output.toBlob(resolve, "image/png"),
  );
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

function cropCanvas(
  source: HTMLCanvasElement,
  crop: Extract<Mark, { tool: "crop" }>,
): HTMLCanvasElement {
  const output = document.createElement("canvas");
  const sx = crop.x * source.width;
  const sy = crop.y * source.height;
  const sw = Math.max(1, crop.w * source.width);
  const sh = Math.max(1, crop.h * source.height);
  output.width = Math.max(1, Math.round(sw));
  output.height = Math.max(1, Math.round(sh));
  output
    .getContext("2d")
    ?.drawImage(source, sx, sy, sw, sh, 0, 0, output.width, output.height);
  return output;
}

function newBatchId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}
