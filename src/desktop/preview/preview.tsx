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
import { formatBytes, relativeTime } from "../history/history";

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
  const [src, setSrc] = React.useState<string>("");
  const [zoom, setZoom] = React.useState<number>(1);

  const id = request.ids[request.index] ?? "";
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
    setSrc("");
    if (!id) {
      return;
    }
    let cancelled = false;
    void api.getHistoryImage(id).then((png) => {
      if (!cancelled && png) {
        setSrc(`data:image/png;base64,${png}`);
      }
    });
    return () => {
      cancelled = true;
    };
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

  return (
    <div className="fixed inset-0 flex flex-col bg-black/95 text-white select-none">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <p className="m-0 truncate text-sm text-white/75">
          {meta
            ? [meta.phoneName, relativeTime(meta.receivedAt), meta.size ? formatBytes(meta.size) : ""]
                .filter(Boolean)
                .join(" · ")
            : ""}
          {request.ids.length > 1 ? ` · ${request.index + 1}/${request.ids.length}` : ""}
        </p>
        <div className="flex items-center gap-1">
          <IconButton label={en.zoomOut} onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
            <ZoomOut className="h-4.5 w-4.5" />
          </IconButton>
          <IconButton label={en.resetZoom} onClick={() => setZoom(1)}>
            <RotateCcw className="h-4 w-4" />
          </IconButton>
          <IconButton label={en.zoomIn} onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
            <ZoomIn className="h-4.5 w-4.5" />
          </IconButton>
          <span className="mx-1.5 h-5 w-px bg-white/20" />
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

      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto">
        {src ? (
          <img
            src={src}
            alt={en.image}
            draggable={false}
            style={{ transform: `scale(${zoom})` }}
            className="max-h-full max-w-full object-contain transition-transform duration-150"
          />
        ) : null}
        {hasPrev ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={en.previous}
            onClick={() => step(-1)}
            className="absolute top-1/2 left-4 h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
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
            className="absolute top-1/2 right-4 h-11 w-11 -translate-y-1/2 rounded-full bg-white/10 text-white hover:bg-white/20 hover:text-white"
          >
            <ChevronRight className="h-6 w-6" />
          </Button>
        ) : null}
      </div>
      <Toaster />
    </div>
  );
}

export async function mountPreview(root: HTMLElement, request: PreviewRequest): Promise<void> {
  const [batches, settings] = await Promise.all([api.listHistory(), api.getSettings()]);
  applyTheme(settings.theme);
  getOrCreateRoot(root).render(<PreviewScreen initial={request} initialBatches={batches} />);
}
