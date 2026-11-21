import * as React from "react";
import {
  ArrowUpRight,
  Crop,
  ChevronLeft,
  ChevronRight,
  CopyPlus,
  Eraser,
  Grid,
  ImagePlus,
  PenTool,
  Loader2,
  Redo2,
  RotateCcw,
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
  drafts: Draft[];
  onClose: () => void;
  onChange?: () => void;
  /** Asks which computers get the toss; false when the user backs out. */
  chooseTargets: () => Promise<boolean>;
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
  const [sel, setSel] = React.useState<number | null>(null);
  const [dragging, setDragging] = React.useState<boolean>(false);
  const [sizeOpen, setSizeOpen] = React.useState<boolean>(false);
  const selectedRef = React.useRef<number | null>(null);
  const handleRef = React.useRef<{ kind: Handle["kind"]; index: number; start: Mark; h0: Pt } | null>(null);
  const moveRef = React.useRef<{ index: number; last: { x: number; y: number }; moved: boolean } | null>(null);
  const textTapRef =React.useRef<{ x: number; y: number } | null>(null);
  const [sending, setSending] = React.useState<boolean>(false);
  const [statusLine, setStatusLine] = React.useState<string>("");
  const [markup, setMarkup] = React.useState<boolean>(true);
  const [deleteOpen, setDeleteOpen] = React.useState<boolean>(false);
  const [discardEditsOpen, setDiscardEditsOpen] = React.useState<boolean>(false);
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
    select(null);
    const mark = currentDraft.marks.splice(-1, 1)[0];
    setRemovedMarks((previous) => [...previous, mark]);
    forceRender();
    paint();
  }

  /** Back to the untouched image: every mark and the crop go; the image stays in the toss. */
  function discardEdits(): void {
    if (!currentDraft) {
      return;
    }
    select(null);
    currentDraft.marks = [];
    setRemovedMarks([]);
    forceRender();
    paint();
  }

  function redoMark(): void {
    if (!currentDraft || removedMarks.length === 0) {
      return;
    }
    const mark = removedMarks[removedMarks.length - 1];
    select(null);
    currentDraft.marks.push(mark);
    setRemovedMarks((previous) => previous.slice(0, -1));
    forceRender();
    paint();
  }

  function select(index: number | null): void {
    selectedRef.current = index;
    setSel(index);
    setSizeOpen(false);
    paint();
  }

  function replaceSelected(next: Mark): void {
    if (sel === null || !currentDraft) {
      return;
    }
    currentDraft.marks[sel] = next;
    forceRender();
    paint();
  }

  function duplicateSelected(): void {
    const mark = sel === null ? undefined : currentDraft?.marks[sel];
    if (!mark || !currentDraft) {
      return;
    }
    currentDraft.marks.push(moveMark(mark, 0.03, 0.03));
    setRemovedMarks([]);
    forceRender();
    select(currentDraft.marks.length - 1);
  }

  function deleteSelected(): void {
    if (sel === null || !currentDraft) {
      return;
    }
    currentDraft.marks.splice(sel, 1);
    setRemovedMarks([]);
    forceRender();
    select(null);
  }

  function selectDraftAt(index: number): void {
    selectedRef.current = null;
    setSel(null);
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
    const picked = selectedRef.current === null ? undefined : currentDraft.marks[selectedRef.current];
    if (picked) {
      drawSelection(ctx, picked, viewRectRef.current);
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
    allowOutside = false,
  ): { x: number; y: number } | null {
    const stage = canvasRef.current;
    if (!stage) {
      return null;
    }
    const bounds = stage.getBoundingClientRect();
    const viewRect = viewRectRef.current;
    const x = (event.clientX - bounds.left - viewRect.x) / viewRect.w;
    const y = (event.clientY - bounds.top - viewRect.y) / viewRect.h;
    if (!allowOutside && (x < 0 || y < 0 || x > 1 || y > 1)) {
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
      select(null);
      setRemovedMarks([]);
      forceRender();
      paint();
    }
  }

  async function handleSend(): Promise<void> {
    setSending(true);
    setStatusLine("");
    // Ask where to toss before the slow part, so the dialog appears at once.
    if (!(await options.chooseTargets())) {
      setSending(false);
      return;
    }
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
      setStatusLine(error instanceof Error ? error.message : en.tossFailed);
      setSending(false);
    }
  }

  const cropMark = currentDraft?.marks.find((m) => m.tool === "crop");
  const selMark = sel === null ? undefined : currentDraft?.marks[sel];
  let menuPos: { left: number; top: number } | null = null;
  const menuCtx = canvasRef.current?.getContext("2d");
  if (selMark && menuCtx) {
    const view = viewRectRef.current;
    const geo = markGeometry(selMark, view, menuCtx);
    const pts = geo.outline.length > 0 ? geo.outline : geo.handles;
    if (pts.length > 0) {
      const xs = pts.map((pt) => pt.x);
      const boxW = stageBoxRef.current?.clientWidth ?? 0;
      const left = view.x + (Math.min(...xs) + Math.max(...xs)) / 2;
      menuPos = {
        left: boxW > 0 ? Math.min(Math.max(left, 100), boxW - 100) : left,
        top: Math.max(4, view.y + Math.min(...pts.map((pt) => pt.y)) - 60),
      };
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


      <AlertDialog open={discardEditsOpen} onOpenChange={setDiscardEditsOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{en.discardEditsTitle}</AlertDialogTitle>
            <AlertDialogDescription>{en.discardEditsDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setDiscardEditsOpen(false);
                discardEdits();
              }}
            >
              {en.discard}
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
            const picked = selectedRef.current === null ? undefined : currentDraft?.marks[selectedRef.current];
            const grip = event.currentTarget.getContext("2d");
            const raw = point(event, true);
            if (picked && grip && raw && selectedRef.current !== null) {
              const view = viewRectRef.current;
              const hit = markGeometry(picked, view, grip).handles.find(
                (h) => Math.hypot(h.x - raw.x * view.w, h.y - raw.y * view.h) <= 22,
              );
              if (hit) {
                handleRef.current = { kind: hit.kind, index: selectedRef.current, start: picked, h0: { x: hit.x, y: hit.y } };
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
                return;
              }
            }
            if (selectedRef.current !== null) {
              select(null);
            }
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
                  setDragging(true);
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
            handleRef.current = null;
            setDragging(false);
            moveRef.current = null;
            draggingRef.current = false;
            currentMarkRef.current = null;
            blankSwipeRef.current = null;
          }}
          onPointerMove={(event) => {
            const grab = handleRef.current;
            if (grab && currentDraft) {
              const p = point(event, true);
              if (p) {
                const view = viewRectRef.current;
                currentDraft.marks[grab.index] = dragHandle(
                  grab.start,
                  grab.kind,
                  { x: p.x * view.w, y: p.y * view.h },
                  grab.h0,
                  view,
                  event.currentTarget.getContext("2d") as CanvasRenderingContext2D,
                );
                paint();
              }
              return;
            }
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
            if (handleRef.current) {
              handleRef.current = null;
              setDragging(false);
              forceRender();
              return;
            }
            const move = moveRef.current;
            if (move) {
              moveRef.current = null;
              setDragging(false);
              if (move.moved) {
                setRemovedMarks([]);
                forceRender();
              }
              select(move.index);
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

        {cropMark && cropMark.tool === "crop" ? (
          <Button
            variant="secondary"
            size="icon"
            aria-label={en.removeCrop}
            title={en.removeCrop}
            className="absolute z-20 h-8 w-8 rounded-full"
            style={{
              left: viewRectRef.current.x + (cropMark.x + cropMark.w) * viewRectRef.current.w - 36,
              top: viewRectRef.current.y + cropMark.y * viewRectRef.current.h + 4,
            }}
            onClick={() => {
              if (currentDraft) {
                currentDraft.marks = currentDraft.marks.filter((m) => m.tool !== "crop");
                setRemovedMarks([]);
                forceRender();
                paint();
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}

        {selMark && menuPos && !dragging ? (
          <div
            className="absolute z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-muted px-1.5 py-1"
            style={{ left: menuPos.left, top: menuPos.top }}
          >
            {selMark.tool === "text" ? (
              sizeOpen ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={en.smaller}
                    className="h-9 rounded-full px-3 text-xs font-bold"
                    onClick={() =>
                      replaceSelected({ ...selMark, size: Math.max(0.3, (selMark.size ?? 1) / 1.15) })
                    }
                  >
                    A-
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={en.larger}
                    className="h-9 rounded-full px-3 text-base font-bold"
                    onClick={() =>
                      replaceSelected({ ...selMark, size: Math.min(8, (selMark.size ?? 1) * 1.15) })
                    }
                  >
                    A+
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={en.fontSize}
                  className="h-9 rounded-full px-3 text-base"
                  onClick={() => setSizeOpen(true)}
                >
                  Aa
                </Button>
              )
            ) : null}
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.duplicate}
              title={en.duplicate}
              className="h-9 w-9 rounded-full"
              onClick={duplicateSelected}
            >
              <CopyPlus className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.deleteElement}
              title={en.deleteElement}
              className="h-9 w-9 rounded-full text-destructive"
              onClick={deleteSelected}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
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
            {/* Always in the bar so it can be found; greyed out until there is an edit. */}
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.discardEdits}
              title={en.discardEdits}
              disabled={(currentDraft?.marks.length ?? 0) === 0}
              className="h-10 w-10 rounded-full text-destructive hover:text-destructive"
              onClick={() => setDiscardEditsOpen(true)}
            >
              <RotateCcw className="h-4 w-4" />
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
    const { size, width } = textMetrics(mark, view, ctx);
    const angle = mark.rotation ?? 0;
    const c = textCenter(mark, size, width, view);
    const dx = px - c.x;
    const dy = py - c.y;
    const lx = dx * Math.cos(angle) + dy * Math.sin(angle);
    const ly = -dx * Math.sin(angle) + dy * Math.cos(angle);
    return Math.abs(lx) <= width / 2 + 8 && Math.abs(ly) <= size / 2 + 8;
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

type Pt = { x: number; y: number };
type Handle = { kind: "resize" | "rotate" | "p1" | "p2"; x: number; y: number };

function textMetrics(
  mark: Extract<Mark, { tool: "text" }>,
  view: View,
  ctx: CanvasRenderingContext2D,
): { size: number; width: number } {
  const size = textSize(view.w) * (mark.size ?? 1);
  ctx.font = `600 ${size}px sans-serif`;
  return { size, width: ctx.measureText(mark.text).width };
}

// Selection outline and drag handles, in view-relative px (add view.x/y to draw).
function markGeometry(
  mark: Mark,
  view: View,
  ctx: CanvasRenderingContext2D,
): { outline: Pt[]; handles: Handle[] } {
  if (mark.tool === "arrow") {
    return {
      outline: [],
      handles: [
        { kind: "p1", x: mark.x1 * view.w, y: mark.y1 * view.h },
        { kind: "p2", x: mark.x2 * view.w, y: mark.y2 * view.h },
      ],
    };
  }
  if (mark.tool === "text") {
    const { size, width } = textMetrics(mark, view, ctx);
    const angle = mark.rotation ?? 0;
    const c = textCenter(mark, size, width, view);
    // (lx, ly) is relative to the box centre; rotation pivots there
    const world = (lx: number, ly: number): Pt => ({
      x: c.x + lx * Math.cos(angle) - ly * Math.sin(angle),
      y: c.y + lx * Math.sin(angle) + ly * Math.cos(angle),
    });
    const hw = width / 2 + 4;
    const hh = size / 2 + 4;
    return {
      outline: [world(-hw, -hh), world(hw, -hh), world(hw, hh), world(-hw, hh)],
      handles: [
        { kind: "resize", ...world(hw, hh) },
        { kind: "rotate", ...world(0, hh + 30) },
      ],
    };
  }
  if (mark.tool === "blur") {
    const x = mark.x * view.w;
    const y = mark.y * view.h;
    const w = mark.w * view.w;
    const h = mark.h * view.h;
    return {
      outline: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }],
      handles: [{ kind: "resize", x: x + w, y: y + h }],
    };
  }
  return { outline: [], handles: [] };
}

// Applies a handle drag to the mark as it was when the drag began.
function textCenter(
  mark: Extract<Mark, { tool: "text" }>,
  size: number,
  width: number,
  view: View,
): Pt {
  return { x: mark.x * view.w + width / 2, y: mark.y * view.h - size / 2 };
}

function dragHandle(
  start: Mark,
  kind: Handle["kind"],
  p: Pt,
  h0: Pt,
  view: View,
  ctx: CanvasRenderingContext2D,
): Mark {
  const nx = p.x / view.w;
  const ny = p.y / view.h;
  if (start.tool === "arrow") {
    return kind === "p1" ? { ...start, x1: nx, y1: ny } : { ...start, x2: nx, y2: ny };
  }
  if (start.tool === "text") {
    const { size, width } = textMetrics(start, view, ctx);
    const c = textCenter(start, size, width, view);
    if (kind === "rotate") {
      const turn = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(h0.y - c.y, h0.x - c.x);
      return { ...start, rotation: (start.rotation ?? 0) + turn };
    }
    const wanted = Math.hypot(p.x - c.x, p.y - c.y) / Math.max(1, Math.hypot(h0.x - c.x, h0.y - c.y));
    const next = Math.min(8, Math.max(0.3, (start.size ?? 1) * wanted));
    const ratio = next / (start.size ?? 1);
    // keep the centre fixed: width and height both scale by ratio
    return {
      ...start,
      size: next,
      x: (c.x - (width * ratio) / 2) / view.w,
      y: (c.y + (size * ratio) / 2) / view.h,
    };
  }
  if (start.tool === "blur") {
    return {
      ...start,
      w: Math.min(1 - start.x, Math.max(0.02, nx - start.x)),
      h: Math.min(1 - start.y, Math.max(0.02, ny - start.y)),
    };
  }
  return start;
}

// lucide "rotate-cw" and "move-diagonal-2" path data (24x24), drawn straight on the canvas
const HANDLE_ICONS: Partial<Record<Handle["kind"], string[]>> = {
  rotate: ["M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8", "M21 3v5h-5"],
  resize: ["M19 13v6h-6", "M5 11V5h6", "m5 5 14 14"],
};

function drawSelection(context: CanvasRenderingContext2D, mark: Mark, view: View): void {
  const { outline, handles } = markGeometry(mark, view, context);
  context.save();
  context.lineWidth = 1.5;
  context.strokeStyle = primaryColor();
  context.setLineDash([5, 4]);
  if (outline.length > 0) {
    context.beginPath();
    outline.forEach((pt, i) =>
      i === 0 ? context.moveTo(view.x + pt.x, view.y + pt.y) : context.lineTo(view.x + pt.x, view.y + pt.y),
    );
    context.closePath();
    context.stroke();
  }
  context.setLineDash([]);
  context.lineWidth = 2;
  const primary = primaryColor();
  for (const handle of handles) {
    const icon = HANDLE_ICONS[handle.kind];
    if (!icon) {
      // arrow end points: plain dot, no ring
      context.beginPath();
      context.arc(view.x + handle.x, view.y + handle.y, 6, 0, Math.PI * 2);
      context.fillStyle = primary;
      context.fill();
      continue;
    }
    context.save();
    context.translate(view.x + handle.x - 12, view.y + handle.y - 12);
    context.scale(1, 1);
    context.lineCap = "round";
    context.lineJoin = "round";
    // white under-stroke keeps the bare icon readable on any image, it is not a border
    context.lineWidth = 5;
    context.strokeStyle = "rgba(255, 255, 255, 0.9)";
    for (const d of icon) {
      context.stroke(new Path2D(d));
    }
    context.lineWidth = 2.4;
    context.strokeStyle = primary;
    for (const d of icon) {
      context.stroke(new Path2D(d));
    }
    context.restore();
  }
  context.restore();
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
    const size = textSize(view.w) * (mark.size ?? 1);
    context.font = `600 ${size}px sans-serif`;
    const width = context.measureText(mark.text).width;
    context.save();
    // rotate around the centre of the text box
    context.translate(view.x + mark.x * view.w + width / 2, view.y + mark.y * view.h - size / 2);
    context.rotate(mark.rotation ?? 0);
    context.lineJoin = "round";
    context.lineWidth = Math.max(3, size * 0.16);
    context.strokeStyle = haloColor(mark.color);
    context.strokeText(mark.text, -width / 2, size / 2);
    context.fillStyle = mark.color;
    context.fillText(mark.text, -width / 2, size / 2);
    context.restore();
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
