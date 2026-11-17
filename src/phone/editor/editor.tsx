import * as React from "react";
import {
  ArrowUpRight,
  ChevronDown,
  Crop,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Grid,
  ImagePlus,
  PenTool,
  Loader2,
  Redo2,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
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
import { ColorPickerButton } from "../../shared/ui/color-picker";
import { filesToBase64 } from "../devices/devices";

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
  onChange?: () => void;
  onSend: (batchId: string, images: string[]) => Promise<void>;
};

const toolIcons: Record<EditorTool, React.ReactNode> = {
  crop: <Crop className="h-4 w-4" />,
  arrow: <ArrowUpRight className="h-4 w-4" />,
  blur: <Grid className="h-4 w-4" />,
  text: <Type className="h-4 w-4" />,
  erase: <Eraser className="h-4 w-4" />,
};

function SendIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" />
      <path d="m21.854 2.147-10.94 10.939" />
    </svg>
  );
}

function PhoneEditorScreen({ options }: { options: Options }): React.JSX.Element {
  const [tool, setTool] = React.useState<EditorTool>("arrow");
  const [color, setColor] = React.useState<string>(markColors[0]);
  const [selected, setSelected] = React.useState<number>(0);
  const [editing, setEditing] = React.useState<{ x: number; y: number; text: string } | null>(null);
  const editingRef = React.useRef(editing);
  editingRef.current = editing;
  const moveRef = React.useRef<{ index: number; last: { x: number; y: number }; moved: boolean } | null>(null);
  const textTapRef =React.useRef<{ x: number; y: number } | null>(null);
  const [sending, setSending] = React.useState<boolean>(false);
  const [statusLine, setStatusLine] = React.useState<string>("");
  const [switchConfirmOpen, setSwitchConfirmOpen] = React.useState<boolean>(false);
  const [markup, setMarkup] = React.useState<boolean>(true);
  const [deleteOpen, setDeleteOpen] = React.useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [removedMarks, setRemovedMarks] = React.useState<Mark[]>([]);
  const [version, forceRender] = React.useReducer((x: number) => x + 1, 0);
  // marks/drafts are mutated in place, so every forceRender is a change worth persisting
  React.useEffect(() => {
    options.onChange?.();
  }, [version]);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const stageBoxRef = React.useRef<HTMLDivElement | null>(null);
  const imageRef = React.useRef<HTMLImageElement>(new Image());
  const viewRectRef = React.useRef({ x: 0, y: 0, w: 1, h: 1 });
  const draggingRef = React.useRef(false);
  const originRef = React.useRef({ x: 0, y: 0 });
  const currentMarkRef = React.useRef<Mark | null>(null);
  const touchSwipeRef = React.useRef<{ x: number; y: number } | null>(null);
  const blankSwipeRef = React.useRef<{ x: number; y: number } | null>(null);
  const pendingBatchIdRef = React.useRef<string | null>(null);

  const currentDraft = options.drafts[selected] ?? options.drafts[0];

  function undoMark(): void {
    if (!currentDraft || currentDraft.marks.length === 0) {
      return;
    }
    const mark = currentDraft.marks.splice(-1, 1)[0];
    setRemovedMarks((previous) => [...previous, mark]);
    forceRender();
    paint();
  }

  function redoMark(): void {
    if (!currentDraft || removedMarks.length === 0) {
      return;
    }
    const mark = removedMarks[removedMarks.length - 1];
    currentDraft.marks.push(mark);
    setRemovedMarks((previous) => previous.slice(0, -1));
    forceRender();
    paint();
  }

  function selectDraftAt(index: number): void {
    setSelected(Math.max(0, index));
    setRemovedMarks([]);
  }

  // drafts is the array send.tsx keeps as pendingDrafts, so mutating it in place keeps both in sync
  function deleteCurrent(): void {
    options.drafts.splice(selected, 1);
    if (options.drafts.length === 0) {
      options.onClose();
      return;
    }
    selectDraftAt(Math.min(selected, options.drafts.length - 1));
    forceRender();
  }

  async function addImages(files: File[]): Promise<void> {
    const encoded = await filesToBase64(files);
    if (encoded.length === 0) {
      return;
    }
    const first = options.drafts.length;
    const stamp = Date.now();
    encoded.forEach((pngBase64, index) =>
      options.drafts.push({ id: `draft-${stamp}-${index}`, pngBase64, marks: [] }),
    );
    selectDraftAt(first);
    forceRender();
  }

  function commitText(): void {
    const current = editingRef.current;
    editingRef.current = null;
    setEditing(null);
    const text = current?.text.trim();
    if (!current || !text || !currentDraft) {
      return;
    }
    currentDraft.marks.push({ tool: "text", x: current.x, y: current.y, text, color });
    setRemovedMarks([]);
    forceRender();
    paint();
  }

  function swipeTo(offset: number): void {
    if (options.drafts.length < 2) {
      return;
    }
    const next = (selected + offset + options.drafts.length) % options.drafts.length;
    selectDraftAt(next);
  }

  function touchCenter(event: React.TouchEvent<HTMLCanvasElement>) {
    return {
      x: (event.touches[0].clientX + event.touches[1].clientX) / 2,
      y: (event.touches[0].clientY + event.touches[1].clientY) / 2,
    };
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
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    stage.style.width = `${width}px`;
    stage.style.height = `${height}px`;
    stage.width = Math.round(width * ratio);
    stage.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
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
    img.src = imageDataUrl(currentDraft.pngBase64);
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

  function eraseAt(event: React.PointerEvent<HTMLCanvasElement>): void {
    const p = point(event);
    const ctx = canvasRef.current?.getContext("2d");
    if (!p || !ctx || !currentDraft) {
      return;
    }
    const view = viewRectRef.current;
    const kept = currentDraft.marks.filter((mark) => !hitMark(mark, p, view, ctx));
    if (kept.length !== currentDraft.marks.length) {
      currentDraft.marks = kept;
      setRemovedMarks([]);
      forceRender();
      paint();
    }
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
    ["erase", en.erase],
  ];

  return (
    <section className="panel editor relative flex h-[100svh] max-h-[100svh] w-full flex-col overflow-hidden bg-background px-2.5 pb-2 text-foreground sm:px-3.5">
      <header className="flex items-center justify-between gap-2 pt-1">
        <Button
          variant="ghost"
          aria-label={en.done}
          onClick={() => {
            options.onClose();
          }}
          className="h-11 px-2 text-base font-semibold"
        >
          {en.done}
        </Button>
        <Button
          variant="secondary"
          aria-label={`${en.toComputer(options.pcName)} - ${options.online ? en.onlineStatus : en.offlineStatus}`}
          className="h-9 min-w-0 justify-center gap-2 rounded-full px-3.5"
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
        <div className="flex items-center gap-1">
        <Button
          variant={markup ? "default" : "secondary"}
          size="icon"
          aria-label={en.markup}
          aria-pressed={markup}
          className="h-11 w-11 rounded-full"
          onClick={() => setMarkup(!markup)}
        >
          <PenTool className="h-5 w-5" />
        </Button>
        <Button
          variant="default"
          size="icon"
          aria-label={en.sendCount(options.drafts.length)}
          title={en.sendCount(options.drafts.length)}
          className="h-11 w-11 rounded-full"
          disabled={sending || options.drafts.length === 0}
          onClick={() => {
            void handleSend();
          }}
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <SendIcon className="h-5 w-5" />
          )}
        </Button>
        </div>
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

      <div className="relative flex min-h-0 flex-1 pt-2">
      <div
        ref={stageBoxRef}
        className="editor-stage relative min-w-0 flex-1 overflow-hidden rounded-xl bg-muted"
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={en.image}
          className="stage block h-full w-full touch-none bg-transparent"
          onTouchStart={(event) => {
            if (event.touches.length >= 2) {
              touchSwipeRef.current = touchCenter(event);
            }
          }}
          onTouchMove={(event) => {
            if (event.touches.length >= 2) {
              event.preventDefault();
            }
          }}
          onTouchEnd={(event) => {
            const start = touchSwipeRef.current;
            touchSwipeRef.current = null;
            if (!start || event.changedTouches.length === 0 || options.drafts.length < 2) {
              return;
            }
            const end = event.changedTouches[0];
            const dx = end.clientX - start.x;
            const dy = end.clientY - start.y;
            if (Math.abs(dx) >= 48 && Math.abs(dy) <= 32) {
              swipeTo(dx < 0 ? 1 : -1);
            }
          }}
          onPointerDown={(event) => {
            const start = point(event);
            if (!currentDraft || !start) {
              blankSwipeRef.current = { x: event.clientX, y: event.clientY };
              return;
            }
            // Dragging a mark of the active tool moves it instead of drawing a new one.
            const ctx = event.currentTarget.getContext("2d");
            if (ctx && tool !== "erase" && tool !== "crop") {
              const marks = currentDraft.marks;
              for (let index = marks.length - 1; index >= 0; index--) {
                if (marks[index].tool === tool && hitMark(marks[index], start, viewRectRef.current, ctx)) {
                  moveRef.current = { index, last: start, moved: false };
                  event.currentTarget.setPointerCapture(event.pointerId);
                  return;
                }
              }
            }
            if (tool === "text") {
              commitText();
              // the input opens on pointerup: focusing it here would be undone by the tap's own focus change
              textTapRef.current = start;
              return;
            }
            if (tool === "erase") {
              eraseAt(event);
            }
            draggingRef.current = true;
            originRef.current = start;
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            moveRef.current = null;
            draggingRef.current = false;
            currentMarkRef.current = null;
            blankSwipeRef.current = null;
          }}
          onPointerMove={(event) => {
            const move = moveRef.current;
            if (move && currentDraft) {
              const p = point(event);
              if (p) {
                currentDraft.marks[move.index] = moveMark(
                  currentDraft.marks[move.index],
                  p.x - move.last.x,
                  p.y - move.last.y,
                );
                move.last = p;
                move.moved = true;
                paint();
              }
              return;
            }
            if (!draggingRef.current) {
              return;
            }
            if (tool === "erase") {
              eraseAt(event);
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
            const move = moveRef.current;
            if (move) {
              moveRef.current = null;
              if (move.moved) {
                setRemovedMarks([]);
                forceRender();
              }
              return;
            }
            const blank = blankSwipeRef.current;
            if (blank) {
              blankSwipeRef.current = null;
              const dx = event.clientX - blank.x;
              const dy = event.clientY - blank.y;
              if (
                options.drafts.length > 1 &&
                Math.abs(dx) >= 48 &&
                Math.abs(dy) <= 32
              ) {
                swipeTo(dx < 0 ? 1 : -1);
              }
              return;
            }
            const tap = textTapRef.current;
            if (tap) {
              textTapRef.current = null;
              setEditing({ x: tap.x, y: tap.y, text: "" });
              return;
            }
            if (!draggingRef.current) {
              return;
            }
            draggingRef.current = false;
            if (tool === "erase") {
              return;
            }
            const end = point(event) ?? originRef.current;
            const mark = markFromDrag(tool, originRef.current, end, color);
            currentMarkRef.current = null;
            if (currentDraft && markHasSize(mark)) {
              if (mark.tool === "crop") {
                currentDraft.marks = currentDraft.marks.filter(
                  (existing) => existing.tool !== "crop",
                );
                setRemovedMarks([]);
              }
              currentDraft.marks.push(mark);
              setRemovedMarks([]);
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
          </div>
        ) : null}

        {editing ? (
          <input
            autoFocus
            maxLength={80}
            placeholder={en.textPlaceholder}
            value={editing.text}
            onChange={(event) => setEditing({ ...editing, text: event.target.value })}
            onBlur={commitText}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                commitText();
              } else if (event.key === "Escape") {
                editingRef.current = null;
                setEditing(null);
              }
            }}
            className="absolute z-10 m-0 rounded border border-dashed border-foreground/40 bg-transparent p-0 outline-none"
            style={{
              left: viewRectRef.current.x + editing.x * viewRectRef.current.w,
              top:
                viewRectRef.current.y +
                editing.y * viewRectRef.current.h -
                textSize(viewRectRef.current.w),
              width: `${Math.max(6, editing.text.length + 1)}ch`,
              font: `600 ${textSize(viewRectRef.current.w)}px sans-serif`,
              lineHeight: 1,
              color,
            }}
          />
        ) : null}
      </div>

        {markup ? (
          <div className="absolute top-1/2 right-1.5 z-10 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full bg-muted/90 p-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.undo}
              disabled={(currentDraft?.marks.length ?? 0) === 0}
              className="h-10 w-10 rounded-full"
              onClick={() => undoMark()}
            >
              <Undo2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.redo}
              disabled={removedMarks.length === 0}
              className="h-10 w-10 rounded-full"
              onClick={() => redoMark()}
            >
              <Redo2 className="h-4 w-4" />
            </Button>
            <div className="my-0.5 h-px w-6 bg-border" />
            {toolButtons.map(([name, label]) => (
              <Button
                key={name}
                variant={tool === name ? "default" : "ghost"}
                size="icon"
                aria-label={label}
                aria-pressed={tool === name}
                title={label}
                className="h-10 w-10 rounded-full"
                onClick={() => setTool(name)}
              >
                {toolIcons[name]}
              </Button>
            ))}
            <ColorPickerButton
              value={color}
              label={en.customColor}
              title={en.customColor}
              className="h-9 w-9"
              onChange={setColor}
            />
            <div className="my-0.5 h-px w-6 bg-border" />
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.addImage}
              title={en.addImage}
              className="h-10 w-10 rounded-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.deleteImage}
              title={en.deleteImage}
              disabled={options.drafts.length === 0}
              className="h-10 w-10 rounded-full text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : null}
      </div>

      {options.drafts.length > 1 ? (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center pt-3 pb-[max(1rem,env(safe-area-inset-bottom,0px))]">
          <div />
          <div className="flex justify-center gap-1">
            {options.drafts.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-label={`${en.image} ${index + 1}`}
                className="p-1"
                onClick={() => selectDraftAt(index)}
              >
                <span
                  className={`block h-2 w-2 rounded-full ${index === selected ? "bg-foreground" : "bg-foreground/30"}`}
                />
              </button>
            ))}
          </div>
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.prevImage}
              className="h-9 w-9 rounded-full"
              onClick={() => swipeTo(-1)}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.nextImage}
              className="h-9 w-9 rounded-full"
              onClick={() => swipeTo(1)}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="pb-[max(1rem,env(safe-area-inset-bottom,0px))]" />
      )}

      <Input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length > 0) {
            void addImages(files);
          }
        }}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{en.deleteImage}</AlertDialogTitle>
            <AlertDialogDescription>{en.deleteImageConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDeleteOpen(false);
                deleteCurrent();
              }}
            >
              {en.deleteImage}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom,0px))] left-3 right-3 z-10 flex justify-center">
        {statusLine ? (
          <p className="m-0 max-w-sm rounded-full bg-background/80 px-3 py-1.5 text-center text-xs font-medium text-destructive backdrop-blur-sm">
            {statusLine}
          </p>
        ) : null}
      </footer>
    </section>
  );
}

type View = { x: number; y: number; w: number; h: number };

// Hit-test and move are the two per-tool behaviours every mark type must provide.
function hitMark(
  mark: Mark,
  p: { x: number; y: number },
  view: View,
  ctx: CanvasRenderingContext2D,
): boolean {
  const px = p.x * view.w;
  const py = p.y * view.h;
  if (mark.tool === "arrow") {
    const ax = mark.x1 * view.w;
    const ay = mark.y1 * view.h;
    const bx = mark.x2 * view.w - ax;
    const by = mark.y2 * view.h - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * bx + (py - ay) * by) / (bx * bx + by * by || 1)));
    return Math.hypot(px - ax - t * bx, py - ay - t * by) <= 16;
  }
  if (mark.tool === "text") {
    const size = textSize(view.w);
    ctx.font = `600 ${size}px sans-serif`;
    const x = mark.x * view.w;
    const y = mark.y * view.h;
    return px >= x - 8 && px <= x + ctx.measureText(mark.text).width + 8 && py >= y - size - 8 && py <= y + 8;
  }
  if (mark.tool === "blur") {
    return p.x >= mark.x && p.x <= mark.x + mark.w && p.y >= mark.y && p.y <= mark.y + mark.h;
  }
  return false; // crop is removed with undo
}

function moveMark(mark: Mark, dx: number, dy: number): Mark {
  if (mark.tool === "arrow") {
    return { ...mark, x1: mark.x1 + dx, y1: mark.y1 + dy, x2: mark.x2 + dx, y2: mark.y2 + dy };
  }
  if (mark.tool === "text") {
    return { ...mark, x: mark.x + dx, y: mark.y + dy };
  }
  if (mark.tool === "crop") {
    return mark;
  }
  return {
    ...mark,
    x: Math.min(1 - mark.w, Math.max(0, mark.x + dx)),
    y: Math.min(1 - mark.h, Math.max(0, mark.y + dy)),
  };
}

function textSize(viewWidth: number): number {
  return Math.max(14, viewWidth * 0.045);
}

function imageDataUrl(base64: string): string {
  const trimmed = base64.trim();
  if (trimmed.startsWith("/9j/")) {
    return `data:image/jpeg;base64,${trimmed}`;
  }
  if (trimmed.startsWith("R0lGOD")) {
    return `data:image/gif;base64,${trimmed}`;
  }
  if (trimmed.startsWith("UklGR")) {
    return `data:image/webp;base64,${trimmed}`;
  }
  return `data:image/png;base64,${trimmed}`;
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
    const size = textSize(view.w);
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
  const source = item.pngBase64.trim();
  const isJpeg = source.startsWith("/9j/");
  const image = await loadImage(imageDataUrl(source));
  const renderScale = Math.min(1, 8192 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvasWidth = Math.max(1, Math.round(image.naturalWidth * renderScale));
  const canvasHeight = Math.max(1, Math.round(image.naturalHeight * renderScale));
  const canvas = document.createElement("canvas");
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    return item.pngBase64;
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
  const view = { x: 0, y: 0, w: canvas.width, h: canvas.height };
  for (const mark of item.marks) {
    if (mark.tool !== "crop") {
      drawMark(context, mark, view, image);
    }
  }
  const crop = [...item.marks].reverse().find((mark) => mark.tool === "crop");
  const output =
    crop && crop.tool === "crop" ? cropCanvas(canvas, crop) : canvas;
  const exportMime = isJpeg ? "image/jpeg" : "image/png";
  const dataUrl =
    exportMime === "image/jpeg"
      ? output.toDataURL(exportMime, 0.95)
      : output.toDataURL(exportMime);
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
