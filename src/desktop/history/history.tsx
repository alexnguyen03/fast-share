import * as React from "react";
import {
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  FolderOpen,
  Link2,
  Pin,
  PinOff,
  RotateCcw,
  Settings as SettingsIcon,
  Smartphone,
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
import { Badge } from "../../shared/ui/badge";
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
import { showToast, dismissToast } from "../../shared/ui/toast";
import { mountPhones } from "../devices/devices";
import { DesktopFrame } from "../frame";
import { mountSettings } from "../settings/settings";

const imageCache = new Map<string, string>();

type FlatItem = {
  imageId: string;
  batchId: string;
  phoneName: string;
  receivedAt: string;
  timeGroup: string;
  pinned: boolean;
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
  phoneName: string;
  receivedAt: string;
};

function TextCard({
  item,
  justCopied,
  onCopy,
  onDelete,
}: {
  item: TextItem;
  justCopied: boolean;
  onCopy: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  return (
    <Card className="flex flex-col gap-2 rounded-2xl border-0 bg-muted p-3">
      <p className="m-0 line-clamp-4 whitespace-pre-wrap wrap-break-word text-sm text-foreground">
        {item.preview}
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {item.phoneName} · {relativeTime(item.receivedAt)}
        </span>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={en.copy}
            onClick={onCopy}
          >
            {justCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={en.delete}
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </Card>
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
          <DialogDescription>{item?.timeGroup ?? ""}</DialogDescription>
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
                size="sm"
                onClick={() => onTogglePin(item.imageId)}
              >
                {item.pinned ? (
                  <PinOff className="h-3.5 w-3.5" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
                <span>{item.pinned ? en.unpinImage : en.pinImage}</span>
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onReveal(item.imageId)}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                onClick={() => onCopy(item.imageId)}
              >
                <Copy className="h-3.5 w-3.5" />
                <span>{en.copy}</span>
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

function DesktopHistoryScreen({
  initialBatches,
  initialStatus,
  onNavigateDevices,
  onNavigateSettings,
}: {
  initialBatches: HistoryBatch[];
  initialStatus: HostStatus;
  onNavigateDevices: () => void;
  onNavigateSettings: () => void;
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
  const pendingDeleteRef = React.useRef<{
    ids: string[];
    timer: number;
    toastId: number;
  } | null>(null);
  const mountedRef = React.useRef<boolean>(true);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const commitDelete = React.useCallback(
    (ids: string[]) => {
      for (const id of ids) {
        imageCache.delete(id);
      }
      void Promise.all(ids.map((id) => api.deleteHistoryImage(id)))
        .catch(() => {
          // The files may already be gone; reload below resyncs the list.
        })
        .then(() => {
          if (!mountedRef.current) {
            return;
          }
          setHiddenIds((prev) => prev.filter((id) => !ids.includes(id)));
          return reload();
        });
    },
    [reload],
  );

  const clearPendingDelete = React.useCallback((): boolean => {
    const pending = pendingDeleteRef.current;
    if (!pending) {
      return false;
    }
    window.clearTimeout(pending.timer);
    if (pending.toastId) {
      dismissToast(pending.toastId);
    }
    pendingDeleteRef.current = null;
    return true;
  }, []);

  const flushPendingDelete = React.useCallback(() => {
    const pending = pendingDeleteRef.current;
    if (!pending) {
      return;
    }
    clearPendingDelete();
    commitDelete(pending.ids);
  }, [clearPendingDelete, commitDelete]);

  const requestDelete = React.useCallback(
    (ids: string[]) => {
      if (ids.length === 0) {
        return;
      }
      flushPendingDelete();
      setHiddenIds((prev) => [...prev, ...ids]);
      setSelectedIds([]);
      setActiveImageId((prev) => (prev && ids.includes(prev) ? null : prev));
      const entry = { ids, timer: 0, toastId: 0 };
      entry.timer = window.setTimeout(() => {
        pendingDeleteRef.current = null;
        dismissToast(entry.toastId);
        commitDelete(ids);
      }, 5000);
      pendingDeleteRef.current = entry;
      entry.toastId = showToast(
        ids.length > 1
          ? en.imagesDeletedToast(ids.length)
          : en.imageDeletedToast,
        "default",
        {
          label: en.undo,
          onAction: () => {
            if (pendingDeleteRef.current !== entry) {
              return;
            }
            window.clearTimeout(entry.timer);
            pendingDeleteRef.current = null;
            setHiddenIds((prev) => prev.filter((id) => !ids.includes(id)));
            showToast(en.deleteUndone);
          },
        },
      );
    },
    [commitDelete, flushPendingDelete],
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
    () => batches.some((b) => b.images.some((img) => img.pinned)),
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

  // Texts have no pin or preview, so they sit in their own list above the image groups.
  const textItems = React.useMemo<TextItem[]>(
    () =>
      effectiveFilter === "pinned"
        ? []
        : batches
            .filter((b) => effectiveFilter === "all" || b.phoneName === effectiveFilter)
            .flatMap((b) =>
              b.texts.map((t) => ({
                ...t,
                phoneName: b.phoneName,
                receivedAt: b.receivedAt,
              })),
            ),
    [batches, effectiveFilter],
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

  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,[role=dialog],[role=menu]")
      ) {
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
    <DesktopFrame>
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
      </header>

      {selectMode ? (
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
                    clearPendingDelete();
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

        {groups.length === 0 && textItems.length === 0 ? (
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
            {textItems.length > 0 ? (
              <div className="flex flex-col gap-2">
                {textItems.map((item) => (
                  <TextCard
                    key={item.id}
                    item={item}
                    justCopied={copiedId === item.id}
                    onCopy={() => {
                      void api.copyHistoryText(item.id).then(() => {
                        markCopied(item.id);
                      });
                    }}
                    onDelete={() => {
                      void api.deleteHistoryText(item.id).then(() => reload());
                    }}
                  />
                ))}
              </div>
            ) : null}
            {groups.map((group) => (
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

      <footer className="mt-auto flex items-center justify-center gap-12 pt-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.devicesTitle}
          title={en.devicesTitle}
          className="relative"
          onClick={onNavigateDevices}
        >
          <Smartphone className="h-6 w-6" />
          {status.pending.length > 0 ? (
            <Badge
              variant="destructive"
              className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 text-xs"
            >
              {status.pending.length}
            </Badge>
          ) : null}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.settings}
          title={en.settings}
          onClick={onNavigateSettings}
        >
          <SettingsIcon className="h-6 w-6" />
        </Button>
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
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <DesktopHistoryScreen
      initialBatches={batches}
      initialStatus={status}
      onNavigateDevices={() => {
        void mountPhones(root, () => {
          void mountDesktop(root);
        });
      }}
      onNavigateSettings={() => {
        void mountSettings(root, () => {
          void mountDesktop(root);
        });
      }}
    />,
  );
}
