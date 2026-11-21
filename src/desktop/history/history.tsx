import * as React from "react";
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Link2,
  Pin,
  PinOff,
  RotateCcw,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { api, type HistoryBatch, type HostStatus } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { FirewallWarning } from "../../shared/firewall-warning";
import { cn } from "../../shared/lib/utils";
import { applyTheme } from "../../shared/settings";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "../../shared/ui/alert-dialog";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Checkbox } from "../../shared/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../../shared/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../shared/ui/dialog";
import { getOrCreateRoot } from "../../shared/ui/render";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { showToast } from "../../shared/ui/toast";
import { mountPhones } from "../devices/devices";
import { DesktopFrame } from "../frame";
import { setDesktopNavigator } from "../nav";
import { mountSettings } from "../settings/settings";

const imageCache = new Map<string, string>();

type FlatItem = {
  imageId: string;
  batchId: string;
  phoneName: string;
  receivedAt: string;
  timeGroup: string;
  pinned: boolean;
  size: number;
};

type TimeGroupSection = {
  label: string;
  items: FlatItem[];
};

async function loadPng(imageId: string): Promise<string> {
  const cached = imageCache.get(imageId);
  if (cached) {
    return cached;
  }
  const png = await api.getHistoryImage(imageId);
  if (png) {
    imageCache.set(imageId, png);
  }
  return png;
}

export function relativeTime(iso: string): string {
  const elapsed = (Date.now() - new Date(iso).getTime()) / 60000;
  if (elapsed < 1) {
    return en.justNow;
  }
  const minutes = Math.floor(elapsed);
  if (minutes < 60) {
    return en.minutesAgo(minutes);
  }
  const hours = Math.floor(elapsed / 60);
  if (hours < 24) {
    return en.hoursAgo(hours);
  }
  return en.daysAgo(Math.floor(hours / 24));
}

function flattenAndGroup(
  batches: HistoryBatch[],
  deviceFilter: string,
  hiddenIds: string[] = [],
): { flat: FlatItem[]; groups: TimeGroupSection[] } {
  const raw: FlatItem[] = [];
  for (const batch of batches) {
    if (
      deviceFilter !== "all" &&
      deviceFilter !== "pinned" &&
      batch.phoneName !== deviceFilter
    ) {
      continue;
    }
    const label = relativeTime(batch.receivedAt);
    for (const img of batch.images) {
      if (hiddenIds.includes(img.id)) {
        continue;
      }
      const pinned = Boolean(img.pinned);
      if (deviceFilter === "pinned" && !pinned) {
        continue;
      }
      raw.push({
        imageId: img.id,
        batchId: batch.id,
        phoneName: batch.phoneName,
        receivedAt: batch.receivedAt,
        timeGroup: label,
        pinned,
        size: img.size ?? 0,
      });
    }
  }

  const pinnedItems = raw.filter((item) => item.pinned);
  const regularItems = raw.filter((item) => !item.pinned);
  const flat = [...pinnedItems, ...regularItems];
  const groups: TimeGroupSection[] = [];

  if (pinnedItems.length > 0) {
    groups.push({
      label: en.pinnedFilter,
      items: pinnedItems,
    });
  }

  for (const item of regularItems) {
    const lastGroup = groups[groups.length - 1];
    if (
      lastGroup &&
      lastGroup.label === item.timeGroup &&
      lastGroup.label !== en.pinnedFilter
    ) {
      lastGroup.items.push(item);
    } else {
      groups.push({ label: item.timeGroup, items: [item] });
    }
  }

  return { flat, groups };
}

type TextItem = {
  id: string;
  preview: string;
  pinned?: boolean;
  phoneName: string;
  receivedAt: string;
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Only the text shows; copy is the click, the rest lives in the right-click menu. */
function TextCard({
  item,
  selected,
  justCopied,
  onCopy,
  onPreview,
  onDetails,
  onTogglePin,
  onDelete,
}: {
  item: TextItem;
  selected: boolean;
  justCopied: boolean;
  onCopy: () => void;
  onPreview: () => void;
  onDetails: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          role="button"
          tabIndex={0}
          data-text-id={item.id}
          title={en.copy}
          onClick={onCopy}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onCopy();
            } else if (event.key === " ") {
              event.preventDefault();
              onPreview();
            }
          }}
          className={cn(
            "group relative cursor-pointer rounded-2xl border-0 bg-muted p-3 pr-9 shadow-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
            selected && "ring-2 ring-primary",
          )}
        >
          <p className="m-0 line-clamp-4 whitespace-pre-wrap wrap-break-word text-sm text-foreground">
            {item.preview}
          </p>
          {item.pinned ? (
            <Pin className="pointer-events-none absolute top-3 right-3 h-3.5 w-3.5 fill-current text-primary group-hover:hidden" />
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={en.delete}
            title={en.delete}
            className="absolute top-1.5 right-1.5 h-7 w-7 text-destructive opacity-0 hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
          {justCopied ? (
            <div className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-2xl bg-black/50 text-xs font-semibold text-white">
              <Check className="h-4 w-4 stroke-[2.8]" />
              {en.copied}
            </div>
          ) : null}
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onCopy}>
          <Copy className="h-4 w-4 opacity-75" />
          <span>{en.copy}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onPreview}>
          <Eye className="h-4 w-4 opacity-75" />
          <span>{en.lightboxPreview}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onDetails}>
          <Info className="h-4 w-4 opacity-75" />
          <span>{en.details}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          {item.pinned ? (
            <PinOff className="h-4 w-4 opacity-75" />
          ) : (
            <Pin className="h-4 w-4 opacity-75" />
          )}
          <span>{item.pinned ? en.unpinImage : en.pinImage}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="h-4 w-4" />
          <span>{en.delete}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** Full text in a dialog, so part of it can be selected and copied. */
function TextPreviewDialog({
  item,
  mode,
  onClose,
}: {
  item: TextItem | null;
  mode: "preview" | "details";
  onClose: () => void;
}): React.JSX.Element {
  const [full, setFull] = React.useState<string>("");

  React.useEffect(() => {
    setFull(item?.preview ?? "");
    if (!item) {
      return;
    }
    let cancelled = false;
    void api.getHistoryText(item.id).then((text) => {
      if (!cancelled) {
        setFull(text);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <div className="pr-8">
          <DialogTitle>{mode === "preview" ? en.lightboxPreview : en.details}</DialogTitle>
          <DialogDescription>
            {item ? `${item.phoneName} · ${relativeTime(item.receivedAt)}` : ""}
          </DialogDescription>
        </div>
        {mode === "preview" ? (
          <div className="max-h-[60vh] overflow-y-auto rounded-xl bg-muted p-3 text-sm whitespace-pre-wrap wrap-break-word text-foreground select-text">
            {full}
          </div>
        ) : item ? (
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{en.detailsFrom}</dt>
            <dd className="m-0">{item.phoneName}</dd>
            <dt className="text-muted-foreground">{en.detailsReceived}</dt>
            <dd className="m-0">{new Date(item.receivedAt).toLocaleString()}</dd>
            <dt className="text-muted-foreground">{en.detailsLength}</dt>
            <dd className="m-0">{en.characters(full.length)}</dd>
          </dl>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LightboxModal({
  item,
  hasPrev,
  hasNext,
  onClose,
  onPrev,
  onNext,
  onCopy,
  onReveal,
  onTogglePin,
}: {
  item: FlatItem | null;
  hasPrev: boolean;
  hasNext: boolean;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onCopy: (id: string) => void;
  onReveal: (id: string) => void;
  onTogglePin: (id: string) => void;
}): React.JSX.Element {
  const [src, setSrc] = React.useState<string>("");
  const [zoom, setZoom] = React.useState<number>(1);

  React.useEffect(() => {
    setZoom(1);
    if (!item) {
      setSrc("");
      return;
    }
    let cancelled = false;
    void loadPng(item.imageId).then((png) => {
      if (!cancelled && png) {
        setSrc(`data:image/png;base64,${png}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item]);

  return (
    <Dialog
      open={item !== null}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" && hasPrev) {
            event.preventDefault();
            onPrev();
          } else if (event.key === "ArrowRight" && hasNext) {
            event.preventDefault();
            onNext();
          }
        }}
      >
        <div className="pr-8">
          <DialogTitle>{item?.phoneName ?? en.image}</DialogTitle>
          <DialogDescription>
            {item ? [item.timeGroup, item.size ? formatBytes(item.size) : ""].filter(Boolean).join(" · ") : ""}
          </DialogDescription>
        </div>

        <div className="relative flex h-[390px] w-full items-center justify-center overflow-auto rounded-xl bg-black/85">
          {src ? (
            <img
              src={src}
              alt={en.image}
              style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
              className="max-h-full max-w-full object-contain transition-transform duration-150"
            />
          ) : null}

          {hasPrev ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={en.previous}
              onClick={onPrev}
              className="absolute left-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full opacity-85 hover:opacity-100"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}

          {hasNext ? (
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label={en.next}
              onClick={onNext}
              className="absolute right-2 top-1/2 h-8 w-8 -translate-y-1/2 rounded-full opacity-85 hover:opacity-100"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          ) : null}
        </div>

        {item ? (
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                title={en.zoomOut}
                onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                className="h-8 w-8"
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                title={en.resetZoom}
                onClick={() => setZoom(1)}
                className="h-8 w-8"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                title={en.zoomIn}
                onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                className="h-8 w-8"
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-8 w-8"
                title={item.pinned ? en.unpinImage : en.pinImage}
                aria-label={item.pinned ? en.unpinImage : en.pinImage}
                onClick={() => onTogglePin(item.imageId)}
              >
                {item.pinned ? (
                  <PinOff className="h-4 w-4" />
                ) : (
                  <Pin className="h-4 w-4" />
                )}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="h-8 w-8"
                title={en.showInExplorer}
                aria-label={en.showInExplorer}
                onClick={() => onReveal(item.imageId)}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="default"
                size="icon"
                className="h-8 w-8"
                title={en.copy}
                aria-label={en.copy}
                onClick={() => onCopy(item.imageId)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function HistoryTile({
  item,
  selected,
  selectMode,
  justCopied,
  showDeviceName,
  onSelect,
  onPreview,
  onOpen,
  onCopyImage,
  onCopyFilePath,
  onRevealInExplorer,
  onTogglePin,
  onEnterSelectMode,
  onDelete,
}: {
  item: FlatItem;
  selected: boolean;
  selectMode: boolean;
  justCopied: boolean;
  showDeviceName: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onOpen: () => void;
  onCopyImage: () => void;
  onCopyFilePath: () => void;
  onRevealInExplorer: () => void;
  onTogglePin: () => void;
  onEnterSelectMode: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const [src, setSrc] = React.useState<string>("");
  const dragOriginRef = React.useRef<{ x: number; y: number } | null>(null);
  const didDragRef = React.useRef<boolean>(false);

  React.useEffect(() => {
    let cancelled = false;
    void loadPng(item.imageId).then((png) => {
      if (!cancelled && png) {
        setSrc(`data:image/png;base64,${png}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [item.imageId]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          role="button"
          tabIndex={0}
          draggable
          aria-label={`${item.phoneName} · ${item.timeGroup}`}
          aria-pressed={selected}
          title={`${item.phoneName} · ${item.timeGroup}`}
          onPointerDown={(event) => {
            if (event.button === 0 && !selectMode) {
              dragOriginRef.current = { x: event.clientX, y: event.clientY };
              didDragRef.current = false;
            }
          }}
          onPointerMove={(event) => {
            const origin = dragOriginRef.current;
            if (!origin || (event.buttons & 1) === 0 || selectMode) {
              dragOriginRef.current = null;
              return;
            }
            const dx = event.clientX - origin.x;
            const dy = event.clientY - origin.y;
            if (dx * dx + dy * dy >= 16) {
              dragOriginRef.current = null;
              didDragRef.current = true;
              void api.startFileDrag(item.imageId);
            }
          }}
          onPointerUp={() => {
            dragOriginRef.current = null;
          }}
          onPointerCancel={() => {
            dragOriginRef.current = null;
          }}
          onDragStart={(event) => {
            event.preventDefault();
            dragOriginRef.current = null;
            if (!didDragRef.current) {
              didDragRef.current = true;
              void api.startFileDrag(item.imageId);
            }
          }}
          onClick={() => {
            if (didDragRef.current) {
              didDragRef.current = false;
              return;
            }
            onSelect();
          }}
          onDoubleClick={onPreview}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSelect();
            } else if (event.key === " ") {
              event.preventDefault();
              onPreview();
            }
          }}
          className={cn(
            "group relative aspect-[4/5] w-full cursor-pointer overflow-hidden rounded-xl border-0 bg-muted p-0 transition-transform focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.99]",
            selected && "ring-2 ring-primary",
          )}
        >
          {src ? (
            <img
              src={src}
              alt={en.image}
              draggable={false}
              className="block h-full w-full select-none object-contain"
            />
          ) : null}

          {item.pinned ? (
            <div className="pointer-events-none absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Pin className="h-3.5 w-3.5 fill-current" />
            </div>
          ) : null}

          {showDeviceName ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pt-4 pb-1.5">
              <span className="block truncate text-xs font-medium text-white">
                {item.phoneName}
              </span>
            </div>
          ) : null}

          {justCopied ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white backdrop-blur-[1px]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-5 w-5 stroke-[2.8]" />
              </div>
              <span className="text-xs font-semibold">{en.copied}</span>
            </div>
          ) : null}

          {selectMode ? (
            <div
              className="pointer-events-none absolute top-2.5 right-2.5"
              aria-hidden="true"
            >
              <Checkbox checked={selected} />
            </div>
          ) : null}
        </Card>
      </ContextMenuTrigger>

      <ContextMenuContent>
        <ContextMenuItem onSelect={onPreview}>
          <Eye className="h-4 w-4 opacity-75" />
          <span>{en.lightboxPreview}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onTogglePin}>
          {item.pinned ? (
            <PinOff className="h-4 w-4 opacity-75" />
          ) : (
            <Pin className="h-4 w-4 opacity-75" />
          )}
          <span>{item.pinned ? en.unpinImage : en.pinImage}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onCopyImage}>
          <Copy className="h-4 w-4 opacity-75" />
          <span>{en.copyImage}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onCopyFilePath}>
          <Link2 className="h-4 w-4 opacity-75" />
          <span>{en.copyFilePath}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onOpen}>
          <ExternalLink className="h-4 w-4 opacity-75" />
          <span>{en.open}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onRevealInExplorer}>
          <FolderOpen className="h-4 w-4 opacity-75" />
          <span>{en.showInExplorer}</span>
        </ContextMenuItem>
        <ContextMenuItem onSelect={onEnterSelectMode}>
          <CheckSquare className="h-4 w-4 opacity-75" />
          <span>{en.select}</span>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 className="h-4 w-4" />
          <span>{en.delete}</span>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

type HistoryTab = "images" | "clipboard";
const TAB_KEY = "fs.desktop.tab";

function loadTab(): HistoryTab {
  try {
    return localStorage.getItem(TAB_KEY) === "clipboard" ? "clipboard" : "images";
  } catch {
    return "images";
  }
}

function saveTab(tab: HistoryTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab);
  } catch {
    // only a convenience; the next start opens on Images
  }
}

function DesktopHistoryScreen({
  initialBatches,
  initialStatus,
}: {
  initialBatches: HistoryBatch[];
  initialStatus: HostStatus;
}): React.JSX.Element {
  const [batches, setBatches] = React.useState<HistoryBatch[]>(initialBatches);
  const [status, setStatus] = React.useState<HostStatus>(initialStatus);
  const [deviceFilter, setDeviceFilter] = React.useState<string>("all");
  const [selectMode, setSelectMode] = React.useState<boolean>(false);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [previewId, setPreviewId] = React.useState<string | null>(null);
  const [activeImageId, setActiveImageId] = React.useState<string | null>(
    initialBatches[0]?.images[0]?.id ?? null,
  );
  const copyTimerRef = React.useRef<number>(0);

  const markCopied = React.useCallback((imageId: string) => {
    window.clearTimeout(copyTimerRef.current);
    setCopiedId(imageId);
    showToast(en.copiedToClipboard);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedId((current) => (current === imageId ? null : current));
    }, 1100);
  }, []);

  const reload = React.useCallback(async (targetBatchId?: string) => {
    const [nextBatches, nextStatus] = await Promise.all([
      api.listHistory(),
      api.hostStatus(),
    ]);
    setBatches(nextBatches);
    setStatus(nextStatus);
    if (targetBatchId) {
      const found = nextBatches.find((b) => b.id === targetBatchId);
      if (found?.images[0]) {
        setActiveImageId(found.images[0].id);
      }
    }
  }, []);

  const [hiddenIds, setHiddenIds] = React.useState<string[]>([]);
  // Images awaiting the delete confirmation; null when the dialog is closed.
  const [confirmDeleteIds, setConfirmDeleteIds] = React.useState<string[] | null>(null);
  const [tab, setTab] = React.useState<HistoryTab>(loadTab);
  const [textDialog, setTextDialog] = React.useState<{
    item: TextItem;
    mode: "preview" | "details";
  } | null>(null);
  const [activeTextId, setActiveTextId] = React.useState<string | null>(null);

  const switchTab = React.useCallback((next: HistoryTab) => {
    setTab(next);
    saveTab(next);
  }, []);

  const requestDelete = React.useCallback((ids: string[]) => {
    if (ids.length > 0) {
      setConfirmDeleteIds(ids);
    }
  }, []);

  const commitDelete = React.useCallback(
    (ids: string[]) => {
      setHiddenIds((prev) => [...prev, ...ids]);
      setSelectedIds([]);
      setActiveImageId((prev) => (prev && ids.includes(prev) ? null : prev));
      for (const id of ids) {
        imageCache.delete(id);
      }
      void Promise.all(ids.map((id) => api.deleteHistoryImage(id)))
        .catch(() => {
          // The files may already be gone; reload below resyncs the list.
        })
        .then(() => {
          showToast(ids.length > 1 ? en.imagesDeletedToast(ids.length) : en.imageDeletedToast);
          setHiddenIds((prev) => prev.filter((id) => !ids.includes(id)));
          return reload();
        });
    },
    [reload],
  );

  React.useEffect(() => {
    let unlisten: (() => void) | null = null;
    void api.onHistoryFocus((batchId) => {
      void reload(batchId);
    }).then((stop) => {
      unlisten = stop;
    });
    return () => {
      unlisten?.();
    };
  }, [reload]);

  const deviceNames = React.useMemo(
    () => Array.from(new Set(batches.map((b) => b.phoneName))),
    [batches],
  );

  const hasPinnedAny = React.useMemo(
    () =>
      batches.some(
        (b) => b.images.some((img) => img.pinned) || b.texts.some((t) => t.pinned),
      ),
    [batches],
  );

  const effectiveFilter =
    deviceFilter === "pinned"
      ? hasPinnedAny
        ? "pinned"
        : "all"
      : deviceFilter !== "all" && !deviceNames.includes(deviceFilter)
        ? "all"
        : deviceFilter;

  const { flat: items, groups } = React.useMemo(
    () => flattenAndGroup(batches, effectiveFilter, hiddenIds),
    [batches, effectiveFilter, hiddenIds],
  );

  // Saved-forever texts first, like the pinned image group.
  const textItems = React.useMemo<TextItem[]>(() => {
    const all = batches
      .filter(
        (b) =>
          effectiveFilter === "all" ||
          effectiveFilter === "pinned" ||
          b.phoneName === effectiveFilter,
      )
      .flatMap((b) =>
        b.texts.map((t) => ({
          ...t,
          phoneName: b.phoneName,
          receivedAt: b.receivedAt,
        })),
      )
      .filter((t) => effectiveFilter !== "pinned" || t.pinned);
    return [...all.filter((t) => t.pinned), ...all.filter((t) => !t.pinned)];
  }, [batches, effectiveFilter]);

  const copyText = React.useCallback(
    (id: string) => {
      setActiveTextId(id);
      void api.copyHistoryText(id).then(() => {
        markCopied(id);
      });
    },
    [markCopied],
  );

  const currentActiveId =
    activeImageId && items.some((i) => i.imageId === activeImageId)
      ? activeImageId
      : (items[0]?.imageId ?? null);

  const previewIndex = previewId
    ? items.findIndex((i) => i.imageId === previewId)
    : -1;
  const previewItem = previewIndex >= 0 ? items[previewIndex] : null;

  const handleTogglePin = React.useCallback(
    (imageId: string) => {
      void api.togglePinImage(imageId).then((pinned) => {
        showToast(pinned ? en.pinnedToast : en.unpinnedToast);
        return reload();
      });
    },
    [reload],
  );

  const handleTogglePinText = React.useCallback(
    (textId: string) => {
      void api.togglePinText(textId).then((pinned) => {
        showToast(pinned ? en.pinnedToast : en.unpinnedToast);
        return reload();
      });
    },
    [reload],
  );

  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,[role=dialog],[role=menu]")
      ) {
        return;
      }
      if (tab !== "images") {
        return;
      }
      if (event.key === "Escape" && selectMode) {
        setSelectMode(false);
        setSelectedIds([]);
        return;
      }
      const targetId = selectMode
        ? (selectedIds[0] ?? null)
        : currentActiveId;
      if (event.key === "Delete") {
        if (selectMode) {
          requestDelete(selectedIds);
        } else if (targetId) {
          requestDelete([targetId]);
        }
        return;
      }
      if (!targetId) {
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        setPreviewId(targetId);
        return;
      }
      if (event.key === "c" || event.key === "C") {
        void api.copyHistoryImage(targetId).then(() => {
          markCopied(targetId);
        });
      }
      if (event.key === "o" || event.key === "O") {
        void api.openHistoryImage(targetId);
      }
      if (event.key === "p" || event.key === "P") {
        handleTogglePin(targetId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    tab,
    selectMode,
    selectedIds,
    currentActiveId,
    reload,
    markCopied,
    handleTogglePin,
    requestDelete,
  ]);

  const showDeviceName =
    effectiveFilter === "all" || effectiveFilter === "pinned";

  return (
    <DesktopFrame active="history" pendingCount={status.pending.length}>
      <header className="flex min-h-9 items-center justify-between gap-2.5">
        <div className="w-12" />
        <Select value={effectiveFilter} onValueChange={setDeviceFilter}>
          <SelectTrigger aria-label={en.recently}>
            <SelectValue placeholder={en.recently} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{en.recently}</SelectItem>
            {hasPinnedAny ? (
              <SelectItem value="pinned">{en.pinnedFilter}</SelectItem>
            ) : null}
            {deviceNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tab === "images" ? (
          <Button
            variant={selectMode ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              setSelectMode((prev) => {
                if (prev) {
                  setSelectedIds([]);
                }
                return !prev;
              });
            }}
          >
            {selectMode ? en.done : en.select}
          </Button>
        ) : (
          <div className="w-12" />
        )}
      </header>

      {selectMode && tab === "images" ? (
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="default"
            size="sm"
            className="flex-1"
            disabled={selectedIds.length === 0}
            onClick={() => {
              const target = selectedIds[0];
              if (target) {
                void api.copyHistoryImage(target).then(() => {
                  markCopied(target);
                });
              }
            }}
          >
            {selectedIds.length > 1 ? en.copyFirst : en.copy}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={selectedIds.length === 0}
            onClick={() => {
              if (selectedIds[0]) {
                setPreviewId(selectedIds[0]);
              }
            }}
          >
            {en.lightboxPreview}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            disabled={selectedIds.length === 0}
            onClick={() => {
              requestDelete(selectedIds);
            }}
          >
            {selectedIds.length > 0
              ? `${en.delete} (${selectedIds.length})`
              : en.delete}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="flex-1"
                disabled={items.length === 0}
              >
                {en.deleteAll}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{en.deleteAll}</AlertDialogTitle>
                <AlertDialogDescription>
                  {en.deleteAllConfirm}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
                <AlertDialogAction
                  variant="destructive"
                  onClick={() => {
                    imageCache.clear();
                    setHiddenIds([]);
                    setSelectedIds([]);
                    void api.deleteHistory().then(() => {
                      showToast(en.historyCleared);
                      return reload();
                    });
                  }}
                >
                  {en.deleteAll}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2">
        {status.pending.length > 0 ? (
          <div className="flex flex-col gap-2">
            {status.pending.map((pending) => (
              <Card
                key={pending.id}
                className="flex flex-col gap-2 border-0 bg-accent p-3"
              >
                <p className="text-sm font-medium">
                  {en.acceptPhone(pending.name)}
                </p>
                {pending.sas ? (
                  <p className="text-xs text-muted-foreground">
                    {en.compareCodeOnComputer(pending.sas)}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => {
                      void api.acceptPhone(pending.id).then(() => {
                        showToast(en.deviceConnectedToast(pending.name));
                        return reload();
                      });
                    }}
                  >
                    {en.accept}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void api.rejectPhone(pending.id).then(() => reload());
                    }}
                  >
                    {en.reject}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : null}

        {batches.length === 0 ? (
          <Card className="my-auto flex flex-col items-center gap-3 rounded-2xl border-0 bg-muted px-4 py-6 text-center">
            <div className="rounded-xl bg-background p-2 ring-1 ring-border/70">
              <img
                src={`data:image/png;base64,${status.qrPngBase64}`}
                alt={en.pairPhone}
                className="h-36 w-36"
              />
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground">
                {status.lanAddress
                  ? `${en.ready} · ${status.lanAddress}`
                  : en.ready}
              </p>
              <p className="max-w-[34ch] text-xs text-muted-foreground">
                {en.scanWithPhone}
              </p>
            </div>
            {status.firewallWarning ? (
              <div className="w-full text-left">
                <FirewallWarning
                  onAllow={() => {
                    void api.allowFirewall().then(() => {
                      showToast(en.firewallAllowed);
                      return reload();
                    });
                  }}
                />
              </div>
            ) : null}
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {tab === "clipboard" ? (
              textItems.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {textItems.map((item) => (
                    <TextCard
                      key={item.id}
                      item={item}
                      selected={item.id === activeTextId}
                      justCopied={copiedId === item.id}
                      onCopy={() => copyText(item.id)}
                      onPreview={() => setTextDialog({ item, mode: "preview" })}
                      onDetails={() => setTextDialog({ item, mode: "details" })}
                      onTogglePin={() => handleTogglePinText(item.id)}
                      onDelete={() => {
                        void api.deleteHistoryText(item.id).then(() => reload());
                      }}
                    />
                  ))}
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">{en.noTextsYet}</p>
              )
            ) : groups.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{en.emptyImagesTab}</p>
            ) : null}
            {tab === "images" && groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <div className="flex items-center justify-center">
                  <span className="rounded-full bg-secondary px-3 py-0.5 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3.5">
                  {group.items.map((item) => {
                    const isSelected = selectMode
                      ? selectedIds.includes(item.imageId)
                      : item.imageId === currentActiveId;
                    return (
                      <HistoryTile
                        key={item.imageId}
                        item={item}
                        selected={isSelected}
                        selectMode={selectMode}
                        justCopied={copiedId === item.imageId}
                        showDeviceName={showDeviceName}
                        onSelect={() => {
                          setActiveImageId(item.imageId);
                          if (selectMode) {
                            setSelectedIds((prev) =>
                              prev.includes(item.imageId)
                                ? prev.filter((id) => id !== item.imageId)
                                : [...prev, item.imageId],
                            );
                          } else {
                            void api.copyHistoryImage(item.imageId).then(() => {
                              markCopied(item.imageId);
                            });
                          }
                        }}
                        onPreview={() => {
                          setActiveImageId(item.imageId);
                          setPreviewId(item.imageId);
                        }}
                        onOpen={() => {
                          void api.openHistoryImage(item.imageId);
                        }}
                        onCopyImage={() => {
                          setActiveImageId(item.imageId);
                          void api.copyHistoryImage(item.imageId).then(() => {
                            markCopied(item.imageId);
                          });
                        }}
                        onCopyFilePath={() => {
                          void api
                            .copyHistoryImagePath(item.imageId)
                            .then(() => {
                              showToast(en.copiedFilePath);
                            });
                        }}
                        onRevealInExplorer={() => {
                          void api.revealHistoryImage(item.imageId);
                        }}
                        onTogglePin={() => {
                          handleTogglePin(item.imageId);
                        }}
                        onEnterSelectMode={() => {
                          setSelectMode(true);
                          setSelectedIds((prev) =>
                            prev.includes(item.imageId)
                              ? prev
                              : [...prev, item.imageId],
                          );
                        }}
                        onDelete={() => {
                          requestDelete([item.imageId]);
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <LightboxModal
        item={previewItem}
        hasPrev={previewIndex > 0}
        hasNext={previewIndex >= 0 && previewIndex < items.length - 1}
        onClose={() => setPreviewId(null)}
        onPrev={() => {
          if (previewIndex > 0) {
            setPreviewId(items[previewIndex - 1].imageId);
          }
        }}
        onNext={() => {
          if (previewIndex >= 0 && previewIndex < items.length - 1) {
            setPreviewId(items[previewIndex + 1].imageId);
          }
        }}
        onCopy={(id) => {
          void api.copyHistoryImage(id).then(() => {
            markCopied(id);
          });
        }}
        onReveal={(id) => {
          void api.revealHistoryImage(id);
        }}
        onTogglePin={(id) => {
          handleTogglePin(id);
        }}
      />

      <TextPreviewDialog
        item={textDialog?.item ?? null}
        mode={textDialog?.mode ?? "preview"}
        onClose={() => setTextDialog(null)}
      />

      <AlertDialog
        open={confirmDeleteIds !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteIds(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {en.deleteImageTitle(confirmDeleteIds?.length ?? 1)}
            </AlertDialogTitle>
            <AlertDialogDescription>{en.deleteHistoryImageConfirm}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmDeleteIds) {
                  commitDelete(confirmDeleteIds);
                }
                setConfirmDeleteIds(null);
              }}
            >
              {en.delete}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <footer className="mt-auto grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
        {(
          [
            ["images", ImageIcon, en.tabImages],
            ["clipboard", ClipboardList, en.tabClipboard],
          ] as const
        ).map(([value, Icon, label]) => (
          <Button
            key={value}
            variant="ghost"
            size="sm"
            aria-pressed={tab === value}
            className={cn(
              "gap-1.5 text-muted-foreground",
              tab === value && "bg-background text-foreground shadow-sm hover:bg-background",
            )}
            onClick={() => {
              setSelectMode(false);
              setSelectedIds([]);
              switchTab(value);
            }}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Button>
        ))}
      </footer>
    </DesktopFrame>
  );
}

export async function mountDesktop(root: HTMLElement): Promise<void> {
  const [batches, status, settings] = await Promise.all([
    api.listHistory(),
    api.hostStatus(),
    api.getSettings(),
  ]);
  applyTheme(settings.theme);
  setDesktopNavigator((view) => {
    const back = (): void => {
      void mountDesktop(root);
    };
    if (view === "devices") {
      void mountPhones(root, back);
    } else if (view === "settings") {
      void mountSettings(root, back);
    } else {
      back();
    }
  });
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <DesktopHistoryScreen initialBatches={batches} initialStatus={status} />,
  );
}
