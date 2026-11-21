import * as React from "react";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Pin,
  PinOff,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, type HistoryBatch } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { applyTheme } from "../../shared/settings";
import { Button } from "../../shared/ui/button";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast, Toaster } from "../../shared/ui/toast";
import { formatBytes, relativeTime, useImageSrc } from "../history/history";

export type PreviewRequest = { ids: string[]; index: number };

type Meta = { phoneName: string; receivedAt: string; pinned: boolean; size: number };

function findMeta(batches: HistoryBatch[], id: string): Meta | null {
  for (const batch of batches) {
    const image = batch.images.find((img) => img.id === id);
    if (image) {
      return {
        phoneName: batch.phoneName,
        receivedAt: batch.receivedAt,
        pinned: Boolean(image.pinned),
        size: image.size ?? 0,
      };
    }
  }
  return null;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-9 w-9 rounded-full text-white/85 hover:bg-white/15 hover:text-white"
    >
      {children}
    </Button>
  );
}

function PreviewScreen({
  initial,
  initialBatches,
}: {
  initial: PreviewRequest;
  initialBatches: HistoryBatch[];
}): React.JSX.Element {
  const [request, setRequest] = React.useState<PreviewRequest>(initial);
  const [batches, setBatches] = React.useState<HistoryBatch[]>(initialBatches);
  React.useEffect(() => setBatches(initialBatches), [initialBatches]);
  const [fullReady, setFullReady] = React.useState<boolean>(false);
  const [zoom, setZoom] = React.useState<number>(1);

  const id = request.ids[request.index] ?? "";
  const thumbSrc = useImageSrc(id, "thumb");
  const fullSrc = useImageSrc(id, "full");
  const meta = findMeta(batches, id);
  const hasPrev = request.index > 0;
  const hasNext = request.index < request.ids.length - 1;

  const step = React.useCallback((delta: number) => {
    setRequest((current) => {
      const index = current.index + delta;
      return index >= 0 && index < current.ids.length ? { ...current, index } : current;
    });
  }, []);

  React.useEffect(() => {
    let stop: (() => void) | null = null;
    void api
      .onPreviewOpen((ids, index) => {
        setRequest({ ids, index });
        void api.listHistory().then(setBatches);
      })
      .then((unlisten) => {
        stop = unlisten;
      });
    return () => stop?.();
  }, []);

  React.useEffect(() => {
    setZoom(1);
    setFullReady(false);
  }, [id]);

  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        void api.closeThisWindow();
      } else if (event.key === "ArrowLeft") {
        step(-1);
      } else if (event.key === "ArrowRight") {
        step(1);
      } else if (event.key === "+" || event.key === "=") {
        setZoom((z) => Math.min(3, z + 0.25));
      } else if (event.key === "-") {
        setZoom((z) => Math.max(0.5, z - 0.25));
      } else if (event.key === "0") {
        setZoom(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const info = [
    meta?.phoneName,
    meta ? relativeTime(meta.receivedAt) : "",
    meta?.size ? formatBytes(meta.size) : "",
    request.ids.length > 1 ? `${request.index + 1}/${request.ids.length}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const zoomStyle = { transform: `scale(${zoom})` };

  return (
    // data-tauri-drag-region: the empty black area moves the borderless window (to another screen too)
    <div data-tauri-drag-region className="fixed inset-0 bg-black text-white select-none">
      <div
        data-tauri-drag-region
        className="absolute inset-0 flex items-center justify-center overflow-auto"
      >
        {thumbSrc && !fullReady ? (
          <img
            src={thumbSrc}
            alt={en.image}
            draggable={false}
            style={zoomStyle}
            className="max-h-full max-w-full object-contain blur-[1px] transition-transform duration-150"
          />
        ) : null}
        {fullSrc ? (
          <img
            key={id}
            src={fullSrc}
            alt={en.image}
            draggable={false}
            decoding="async"
            onLoad={() => setFullReady(true)}
            style={zoomStyle}
            className={
              fullReady
                ? "max-h-full max-w-full object-contain transition-transform duration-150"
                : "pointer-events-none absolute h-0 w-0 opacity-0"
            }
          />
        ) : null}
      </div>

      {hasPrev ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={en.previous}
          onClick={() => step(-1)}
          className="absolute top-1/2 left-4 h-11 w-11 -translate-y-1/2 rounded-full bg-black/35 text-white backdrop-blur-md hover:bg-black/55 hover:text-white"
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
      ) : null}
      {hasNext ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={en.next}
          onClick={() => step(1)}
          className="absolute top-1/2 right-4 h-11 w-11 -translate-y-1/2 rounded-full bg-black/35 text-white backdrop-blur-md hover:bg-black/55 hover:text-white"
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      ) : null}

      <div
        data-tauri-drag-region
        className="absolute bottom-6 left-1/2 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded-full bg-black/45 py-1 pr-1 pl-4 shadow-lg ring-1 ring-white/10 backdrop-blur-md"
      >
        <p data-tauri-drag-region className="m-0 min-w-0 truncate text-sm text-white/80">
          {info}
        </p>
        <span className="mx-1 h-5 w-px shrink-0 bg-white/20" />
        <div className="flex shrink-0 items-center">
          <IconButton label={en.zoomOut} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4.5 w-4.5" />
          </IconButton>
          <IconButton label={en.resetZoom} onClick={() => setZoom(1)}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
          <IconButton label={en.zoomIn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4.5 w-4.5" />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-white/20" />
          <IconButton
            label={meta?.pinned ? en.unpinImage : en.pinImage}
            onClick={() => {
              void api.togglePinImage(id).then((pinned) => {
                showToast(pinned ? en.pinnedToast : en.unpinnedToast);
                return api.listHistory().then(setBatches);
              });
            }}
          >
            {meta?.pinned ? <PinOff className="h-4.5 w-4.5" /> : <Pin className="h-4.5 w-4.5" />}
          </IconButton>
          <IconButton label={en.showInExplorer} onClick={() => void api.revealHistoryImage(id)}>
            <FolderOpen className="h-4.5 w-4.5" />
          </IconButton>
          <IconButton
            label={en.copy}
            onClick={() => {
              void api.copyHistoryImage(id).then(() => showToast(en.copiedToClipboard));
            }}
          >
            <Copy className="h-4.5 w-4.5" />
          </IconButton>
          <IconButton label={en.close} onClick={() => void api.closeThisWindow()}>
            <X className="h-5 w-5" />
          </IconButton>
        </div>
      </div>
      <Toaster />
    </div>
  );
}

export async function mountPreview(root: HTMLElement, request: PreviewRequest): Promise<void> {
  // Draw first: the image and the close button do not need the history list.
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(<PreviewScreen initial={request} initialBatches={[]} />);
  const [batches, settings] = await Promise.all([api.listHistory(), api.getSettings()]);
  applyTheme(settings.theme);
  reactRoot.render(<PreviewScreen initial={request} initialBatches={batches} />);
}
