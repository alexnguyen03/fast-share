import * as React from "react";
import {
  Check,
  Settings as SettingsIcon,
  Smartphone,
} from "lucide-react";
import { api, type HistoryBatch, type HostStatus } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
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
  const flat: FlatItem[] = [];
  const groups: TimeGroupSection[] = [];
  for (const batch of batches) {
    if (deviceFilter !== "all" && batch.phoneName !== deviceFilter) {
      continue;
    }
    const label = relativeTime(batch.receivedAt);
    for (const img of batch.images) {
      const item: FlatItem = {
        imageId: img.id,
        batchId: batch.id,
        phoneName: batch.phoneName,
        receivedAt: batch.receivedAt,
        timeGroup: label,
      };
      flat.push(item);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.label === label) {
        lastGroup.items.push(item);
      } else {
        groups.push({ label, items: [item] });
      }
    }
  }
  return { flat, groups };
}

function HistoryTile({
  item,
  selected,
  selectMode,
  justCopied,
  showDeviceName,
  onSelect,
  onOpen,
}: {
  item: FlatItem;
  selected: boolean;
  selectMode: boolean;
  justCopied: boolean;
  showDeviceName: boolean;
  onSelect: () => void;
  onOpen: () => void;
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
    <Card
      role="button"
      tabIndex={0}
      title={`${item.phoneName} · ${item.timeGroup}`}
      onClick={onSelect}
      onDoubleClick={onOpen}
      className={cn(
        "relative flex cursor-pointer flex-col gap-1.5 rounded-xl border-0 bg-[#f0f3ee] p-2 text-left transition-colors hover:bg-[#e7ece4]",
        selected && "bg-[#dff2e7]",
      )}
    >
      <div className="relative grid aspect-[1.15/1] w-full place-items-center overflow-hidden rounded-lg bg-white">
        {src ? (
          <img
            src={src}
            alt={en.image}
            className="block h-full w-full object-cover"
          />
        ) : null}

        {justCopied ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white backdrop-blur-[1px]">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-5 w-5 stroke-[2.8]" />
            </div>
            <span className="text-xs font-semibold">{en.copy}</span>
          </div>
        ) : null}
      </div>

      {selectMode ? (
        <div
          className="pointer-events-none absolute top-3.5 right-3.5"
          aria-hidden="true"
        >
          <Checkbox checked={selected} />
        </div>
      ) : null}

      {showDeviceName ? (
        <div className="flex items-center px-0.5 text-[0.75rem]">
          <span className="truncate font-medium text-[#262c30]">
            {item.phoneName}
          </span>
        </div>
      ) : null}
    </Card>
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

  const effectiveFilter =
    deviceFilter !== "all" && !deviceNames.includes(deviceFilter)
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

  React.useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest("input,textarea,[role=dialog]")
      ) {
        return;
      }
      const targetId =
        selectMode && selectedIds.length > 0 ? selectedIds[0] : currentActiveId;
      if (!targetId) {
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
  }, [selectMode, selectedIds, currentActiveId, reload, markCopied]);

  const showDeviceName = effectiveFilter === "all";

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
                void api.openHistoryImage(selectedIds[0]);
              }
            }}
          >
            {en.open}
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

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {groups.length === 0 ? (
          <p className="my-12 text-center text-[0.95rem] text-[#69737a]">
            {en.emptyHistory}
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <div key={group.label} className="flex flex-col gap-2">
                <div className="flex items-center justify-center">
                  <span className="rounded-full bg-[#eef2eb] px-3 py-0.5 text-xs font-medium text-[#5c666e]">
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
                        onOpen={() => {
                          void api.openHistoryImage(item.imageId);
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
            className="mt-2.5 flex flex-col gap-2 border-0 bg-[#eefaf2] p-3"
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
  const [batches, status] = await Promise.all([
    api.listHistory(),
    api.hostStatus(),
  ]);
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
