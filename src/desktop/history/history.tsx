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
import { showToast } from "../../shared/ui/toast";
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
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) {
    return en.justNow;
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return en.hoursAgo(hours);
  }
  return en.daysAgo(Math.round(hours / 24));
}

function flattenAndGroup(
  batches: HistoryBatch[],
  deviceFilter: string,
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
          title={`${item.phoneName} · ${item.timeGroup}`}
          onDragStart={(event) => {
            event.preventDefault();
            void api.startFileDrag(item.imageId);
          }}
          onClick={onSelect}
          onDoubleClick={onPreview}
          className={cn(
            "group relative aspect-[1.15/1] w-full cursor-pointer overflow-hidden rounded-xl border-0 bg-muted p-0 transition-transform active:scale-[0.99]",
            selected && "ring-2 ring-primary",
          )}
        >
          {src ? (
            <img
              src={src}
              alt={en.image}
              draggable={false}
              className="block h-full w-full select-none object-cover"
            />
          ) : null}

          {item.pinned ? (
            <div className="pointer-events-none absolute top-2 left-2 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Pin className="h-3.5 w-3.5 fill-current" />
            </div>
          ) : null}

          {showDeviceName ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 via-black/25 to-transparent px-2.5 pt-4 pb-1.5">
              <span className="block truncate text-[0.74rem] font-medium text-white">
                {item.phoneName}
              </span>
            </div>
          ) : null}

          {justCopied ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white backdrop-blur-[1px]">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Check className="h-5 w-5 stroke-[2.8]" />
              </div>
              <span className="text-xs font-semibold">{en.copy}</span>
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
    () => flattenAndGroup(batches, effectiveFilter),
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
      const targetId =
        selectMode && selectedIds.length > 0 ? selectedIds[0] : currentActiveId;
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
      if (event.key === "Delete") {
        if (selectMode && selectedIds.length > 0) {
          void Promise.all(
            selectedIds.map((id) => {
              imageCache.delete(id);
              return api.deleteHistoryImage(id);
            }),
          ).then(() => {
            setSelectedIds([]);
            showToast(en.imageDeletedToast);
            return reload();
          });
        } else {
          imageCache.delete(targetId);
          void api.deleteHistoryImage(targetId).then(() => {
            showToast(en.imageDeletedToast);
            return reload();
          });
        }
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
            {selectedIds.length > 0
              ? `${en.copy} (${selectedIds.length})`
              : en.copy}
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
              if (selectedIds.length === 0) {
                return;
              }
              void Promise.all(
                selectedIds.map((id) => {
                  imageCache.delete(id);
                  return api.deleteHistoryImage(id);
                }),
              ).then(() => {
                setSelectedIds([]);
                showToast(en.imageDeletedToast);
                return reload();
              });
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
                  onClick={() => {
                    imageCache.clear();
                    setSelectedIds([]);
                    showToast(en.imageDeletedToast);
                    void api.deleteHistory().then(() => reload());
                  }}
                >
                  {en.deleteAll}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {groups.length === 0 ? (
          <p className="my-12 text-center text-[0.95rem] text-muted-foreground">
            {en.emptyHistory}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
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
                          imageCache.delete(item.imageId);
                          setSelectedIds((prev) =>
                            prev.filter((id) => id !== item.imageId),
                          );
                          void api
                            .deleteHistoryImage(item.imageId)
                            .then(() => {
                              showToast(en.imageDeletedToast);
                              return reload();
                            });
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {status.pending.map((pending) => (
          <Card
            key={pending.id}
            className="mt-2.5 flex flex-col gap-2 border-0 bg-accent p-3"
          >
            <p className="text-sm font-medium">{en.acceptPhone(pending.name)}</p>
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
              className="absolute top-0.5 right-0.5 h-4 min-w-4 px-1 text-[0.68rem]"
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
