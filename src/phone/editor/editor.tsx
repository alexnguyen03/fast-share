import * as React from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Crop,
  Grid,
  Loader2,
  Type,
  Undo2,
  X,
} from "lucide-react";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
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

const toolIcons: Record<EditorTool, React.ReactNode> = {
  crop: <Crop className="h-4 w-4" />,
  arrow: <ArrowUpRight className="h-4 w-4" />,
  blur: <Grid className="h-4 w-4" />,
  text: <Type className="h-4 w-4" />,
};

function PhoneEditorScreen({ options }: { options: Options }): React.JSX.Element {
  const [tool, setTool] = React.useState<EditorTool>("arrow");
  const [color, setColor] = React.useState<string>(markColors[0]);
  const [selected, setSelected] = React.useState<number>(0);
  const [textValue, setTextValue] = React.useState<string>("");
  const [sending, setSending] = React.useState<boolean>(false);
  const [statusLine, setStatusLine] = React.useState<string>("");
  const [switchConfirmOpen, setSwitchConfirmOpen] = React.useState<boolean>(false);
  const [removedDraft, setRemovedDraft] = React.useState<{
    draft: Draft;
    index: number;
  } | null>(null);
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
  const undoRemoveTimerRef = React.useRef<number>(0);

  React.useEffect(() => {
    return () => window.clearTimeout(undoRemoveTimerRef.current);
  }, []);

  function removeDraftAt(index: number): void {
    const draft = options.drafts[index];
    if (!draft || sending) {
      return;
    }
    options.drafts.splice(index, 1);
    setRemovedDraft({ draft, index });
    setSelected((prev) =>
      Math.max(0, Math.min(prev, options.drafts.length - 1)),
    );
    forceRender();
    window.clearTimeout(undoRemoveTimerRef.current);
    undoRemoveTimerRef.current = window.setTimeout(() => {
      setRemovedDraft(null);
    }, 7000);
  }

  function undoRemove(): void {
    if (!removedDraft) {
      return;
    }
    window.clearTimeout(undoRemoveTimerRef.current);
    options.drafts.splice(removedDraft.index, 0, removedDraft.draft);
    setSelected(removedDraft.index);
    setRemovedDraft(null);
    forceRender();
  }

  const paint = React.useCallback(() => {
    const stage = canvasRef.current;
    const box = stageBoxRef.current;
    if (!stage || !box) {
      return;
    }
    const ctx = stage.getContext("2d");
    if (!ctx) {
      return;
    }
    if (!currentDraft) {
      ctx.clearRect(0, 0, stage.width, stage.height);
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
    <section className="panel editor flex min-h-screen w-full flex-col bg-background px-3.5 text-foreground">
      <header className="grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-2.5">
        <Button
          variant="secondary"
          size="icon"
          aria-label={en.close}
          onClick={() => {
            options.onClose();
          }}
          className="h-11 w-11 rounded-full"
        >
          <X className="h-4 w-4" />
        </Button>

        <Button
          variant="secondary"
          aria-label={`${en.toComputer(options.pcName)} — ${options.online ? en.onlineStatus : en.offlineStatus}`}
          className="h-11 min-w-0 justify-center gap-2 rounded-full px-3.5"
          onClick={() => {
            if (options.drafts.some((item) => item.marks.length > 0)) {
              setSwitchConfirmOpen(true);
              return;
            }
            options.onSwitch();
          }}
        >
          <span className={options.online ? "dot on shrink-0" : "dot shrink-0"} />
          <span className="truncate">{en.toComputer(options.pcName)}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-75" />
        </Button>

        <Button
          variant="default"
          className="h-11 gap-1.5 rounded-full px-4 font-semibold"
          disabled={sending || options.drafts.length === 0}
          onClick={() => {
            void handleSend();
          }}
        >
          <span>{sending ? en.sending : en.sendCount(options.drafts.length)}</span>
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ArrowRight className="h-4 w-4" />
          )}
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

      <div
        ref={stageBoxRef}
        className="editor-stage relative my-3 min-h-0 flex-1 overflow-hidden rounded-2xl bg-muted"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={en.image}
          className="stage block h-full w-full touch-none bg-transparent"
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

        {options.drafts.length === 0 ? (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">
              {en.noImagesLeft}
            </p>
            {removedDraft ? (
              <Button
                variant="secondary"
                size="sm"
                className="pointer-events-auto"
                onClick={undoRemove}
              >
                <Undo2 className="h-4 w-4" />
                <span>{en.undo}</span>
              </Button>
            ) : null}
          </div>
        ) : null}

        <div className="absolute top-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-popover/95 p-1.5 ring-1 ring-border/70 backdrop-blur-sm">
          {toolButtons.map(([name, label]) => (
            <Button
              key={name}
              variant={tool === name ? "default" : "ghost"}
              size="icon"
              aria-label={label}
              aria-pressed={tool === name}
              className="h-11 w-11 rounded-full"
              onClick={() => setTool(name)}
            >
              {toolIcons[name]}
            </Button>
          ))}
          <span className="mx-1 h-5 w-px bg-border" />
          <Button
            variant="ghost"
            size="icon"
            aria-label={en.undo}
            disabled={(currentDraft?.marks.length ?? 0) === 0}
            className="h-11 w-11 rounded-full"
            onClick={() => {
              currentDraft?.marks.pop();
              forceRender();
              paint();
            }}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="absolute top-16 right-3 left-3 z-10 flex flex-col items-center gap-2">
          {tool === "arrow" || tool === "text" ? (
            <div className="flex items-center gap-2 rounded-full bg-popover/95 px-2.5 py-1.5 ring-1 ring-border/70 backdrop-blur-sm">
              {markColors.map((value, index) => (
                <Button
                  key={value}
                  variant="ghost"
                  aria-label={colorLabels[index] ?? value}
                  aria-pressed={color === value}
                  title={colorLabels[index] ?? value}
                  style={{ background: value }}
                  className={cn(
                    "h-10 w-10 rounded-full p-0",
                    color === value && "ring-2 ring-primary ring-offset-2",
                  )}
                  onClick={() => setColor(value)}
                />
              ))}
            </div>
          ) : null}

          {tool === "text" ? (
            <div className="w-full max-w-xs">
              <Input
                type="text"
                maxLength={80}
                placeholder={en.textPlaceholder}
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                className="rounded-full bg-popover/95 ring-1 ring-border/70"
              />
            </div>
          ) : null}
        </div>
      </div>

      <footer className="flex flex-col items-center gap-2">
        <div className="flex w-full justify-center gap-2 overflow-x-auto py-0.5">
          {options.drafts.map((item, index) => (
            <ThumbButton
              key={item.id}
              item={item}
              index={index}
              selected={index === selected}
              onSelect={() => setSelected(index)}
              onRemove={() => removeDraftAt(index)}
            />
          ))}
        </div>
        {options.drafts.length > 0 ? (
          <p className="m-0 text-center text-xs text-muted-foreground">
            {en.editHint}
          </p>
        ) : null}
        {removedDraft ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{en.imageRemoved}</span>
            <Button
              variant="secondary"
              size="sm"
              className="h-7 px-2.5"
              onClick={undoRemove}
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>{en.undo}</span>
            </Button>
          </div>
        ) : null}
        {statusLine ? (
          <p className="m-0 text-center text-xs font-medium text-destructive">
            {statusLine}
          </p>
        ) : null}
      </footer>
    </section>
  );
}

function ThumbButton({
  item,
  index,
  selected,
  onSelect,
  onRemove,
}: {
  item: Draft;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="relative shrink-0">
      <Button
        variant="ghost"
        aria-label={`${en.image} ${index + 1}`}
        aria-pressed={selected}
        className={cn(
          "h-[70px] w-[54px] overflow-hidden rounded-lg bg-muted p-0 transition-opacity",
          selected
            ? "opacity-100 ring-2 ring-primary"
            : "opacity-60 hover:opacity-90",
        )}
        onKeyDown={(event) => {
          if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            onRemove();
          }
        }}
        onClick={onSelect}
      >
        <img
          src={`data:image/png;base64,${item.pngBase64}`}
          alt={en.image}
          className="h-full w-full object-contain"
        />
        {item.marks.length > 0 ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1 left-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="h-2.5 w-2.5 stroke-[3]" />
          </span>
        ) : null}
      </Button>
      <Button
        variant="secondary"
        size="icon"
        aria-label={`${en.removeImage} ${index + 1}`}
        title={en.removeImage}
        className="absolute top-0.5 right-0.5 h-6 w-6 rounded-full bg-foreground/85 p-0 text-background hover:bg-foreground"
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
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
    const x = view.x + mark.x * view.w;
    const y = view.y + mark.y * view.h;
    const w = mark.w * view.w;
    const h = mark.h * view.h;
    const right = view.x + view.w;
    const bottom = view.y + view.h;
    const unit = Math.max(1, view.w / 400);
    context.save();
    context.fillStyle = "rgba(0, 0, 0, 0.5)";
    if (y > view.y) {
      context.fillRect(view.x, view.y, view.w, y - view.y);
    }
    if (y + h < bottom) {
      context.fillRect(view.x, y + h, view.w, bottom - (y + h));
    }
    if (x > view.x) {
      context.fillRect(view.x, y, x - view.x, h);
    }
    if (x + w < right) {
      context.fillRect(x + w, y, right - (x + w), h);
    }
    context.restore();
    context.strokeStyle = "rgba(0, 0, 0, 0.45)";
    context.lineWidth = 4 * unit;
    context.strokeRect(x, y, w, h);
    context.strokeStyle = primaryColor();
    context.lineWidth = 2 * unit;
    context.strokeRect(x, y, w, h);
    return;
  }
  if (mark.tool === "arrow") {
    drawArrow(context, view, mark);
    return;
  }
  if (mark.tool === "text") {
    const size = Math.max(14, view.w * 0.045);
    const x = view.x + mark.x * view.w;
    const y = view.y + mark.y * view.h;
    context.font = `600 ${size}px sans-serif`;
    context.lineJoin = "round";
    context.lineWidth = Math.max(3, size * 0.16);
    context.strokeStyle = haloColor(mark.color);
    context.strokeText(mark.text, x, y);
    context.fillStyle = mark.color;
    context.fillText(mark.text, x, y);
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
  const halo = haloColor(mark.color);
  const unit = Math.max(1, view.w / 400);
  context.lineCap = "round";
  context.lineJoin = "round";

  const strokeLine = (): void => {
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  };

  context.strokeStyle = halo;
  context.lineWidth = 7 * unit;
  strokeLine();
  context.strokeStyle = mark.color;
  context.lineWidth = 3 * unit;
  strokeLine();

  const angle = Math.atan2(y2 - y1, x2 - x1);
  const head = 12 * unit;
  context.beginPath();
  context.moveTo(x2, y2);
  context.lineTo(
    x2 - head * Math.cos(angle - 0.4),
    y2 - head * Math.sin(angle - 0.4),
  );
  context.lineTo(
    x2 - head * Math.cos(angle + 0.4),
    y2 - head * Math.sin(angle + 0.4),
  );
  context.closePath();
  context.strokeStyle = halo;
  context.lineWidth = 4 * unit;
  context.stroke();
  context.fillStyle = mark.color;
  context.fill();
}

function primaryColor(): string {
  if (typeof document === "undefined") {
    return "#0f8a4b";
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--primary")
    .trim();
  return value || "#0f8a4b";
}

function haloColor(color: string): string {
  const value = color.toLowerCase();
  return value === "#ffffff" || value === "#fff" || value === "white"
    ? "rgba(10, 14, 12, 0.55)"
    : "rgba(255, 255, 255, 0.92)";
}

async function exportDraft(item: Draft): Promise<string> {
  if (item.marks.length === 0) {
    return item.pngBase64;
  }
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
  const dataUrl = output.toDataURL("image/jpeg", 0.92);
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : item.pngBase64;
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
