import * as React from "react";
import {
  ArrowUpFromLine,
  ChevronLeft,
  ClipboardPaste,
  Laptop,
  Loader2,
  X,
} from "lucide-react";
import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
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
} from "../../shared/ui/alert-dialog";
import { cn } from "../../shared/lib/utils";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Checkbox } from "../../shared/ui/checkbox";
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { filesToBase64, mountDevices } from "../devices/devices";
import { mountEditor, type Draft } from "../editor/editor";
import { PhoneFrame, type PhoneTab } from "../frame";
import { loadDrafts, saveDrafts } from "../draft-store";
import { buzzIfEnabled } from "../haptics";
import { errorText, note } from "../log";
import { mountPhoneSettings } from "../settings/settings";

let inboxBound = false;
let takingInbox = false;

const TARGETS_KEY = "fs.phone.targets";
const DESTINATIONS_SHOWN = 3;

function loadTargets(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TARGETS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveTargets(ids: string[]): void {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(ids));
  } catch {
    // only a convenience: the first computer is picked next time
  }
}

/** The remembered targets that still exist, else the first online (or first known) computer. */
function initialTargets(known: Destination[]): string[] {
  const kept = loadTargets().filter((id) => known.some((pc) => pc.pcId === id));
  if (kept.length > 0) {
    return kept;
  }
  const first = known.find((pc) => pc.online) ?? known[0];
  return first ? [first.pcId] : [];
}

/** Sends to each computer in turn; resolves with the names that failed, with their errors. */
async function sendToEach(
  pcs: Destination[],
  send: (pc: Destination) => Promise<void>,
): Promise<{ ok: Destination[]; failed: { pc: Destination; error: string }[] }> {
  const ok: Destination[] = [];
  const failed: { pc: Destination; error: string }[] = [];
  for (const pc of pcs) {
    try {
      await send(pc);
      ok.push(pc);
    } catch (error) {
      failed.push({ pc, error: errorText(error) });
    }
  }
  return { ok, failed };
}

function joinNames(pcs: Destination[]): string {
  return pcs.map((pc) => pc.name).join(", ");
}

/**
 * Drafts that were started but interrupted (destination picked, editor closed,
 * tab switched). Keeping them here means the images taken from the share inbox
 * are never lost until the user sends or explicitly discards them.
 */
let pendingDrafts: Draft[] | null = null;

let restored = false;
let resumeOnce = false;

// Android's edge panel opens the app with this event; the clipboard can only be read once the app is in front.
const CLIPBOARD_EVENT = "fast-share-clipboard";
let clipboardRequested = false;

async function readClipboard(): Promise<string> {
  try {
    const bridge = window.__FAST_SHARE_ANDROID__;
    if (bridge) {
      return bridge.readClipboardText();
    }
    return await navigator.clipboard.readText();
  } catch {
    return ""; // denied or unsupported: the preview opens empty so the user can paste by hand
  }
}

function newTextBatchId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `text-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function keepDrafts(drafts: Draft[]): void {
  pendingDrafts = drafts.length > 0 ? drafts : null;
  saveDrafts(drafts);
}

export async function mountPhone(
  root: HTMLElement,
  initialTab: PhoneTab = "send",
): Promise<void> {
  const settings = await api.getSettings();
  applyTheme(settings.theme);

  // After the OS kills the webview, pick the unsent drafts back up and reopen the editor.
  if (!restored) {
    restored = true;
    const saved = await loadDrafts();
    if (saved.length > 0 && !pendingDrafts) {
      pendingDrafts = saved;
      resumeOnce = true;
    }
  }

  if (!inboxBound) {
    inboxBound = true;
    const refreshInbox = () => {
      if (document.visibilityState === "visible") {
        void consumeInbox(root, true);
      }
    };
    window.addEventListener("fast-share-inbox", () => {
      void consumeInbox(root, true, initialTab);
    });
    window.addEventListener(CLIPBOARD_EVENT, () => {
      // Make sure the Send screen is showing; it opens the preview from this flag or the event itself.
      window.__FAST_SHARE_ANDROID__?.takeClipboardRequest();
      clipboardRequested = true;
      void mountPhone(root, "send");
    });
    window.addEventListener("visibilitychange", refreshInbox);
    window.addEventListener("focus", refreshInbox);
    window.setInterval(refreshInbox, 2500);
  }
  // Cold start: the panel launched the app before this page could hear the event.
  if (window.__FAST_SHARE_ANDROID__?.takeClipboardRequest()) {
    clipboardRequested = true;
  }
  await consumeInbox(root, false, initialTab);
}

function navigateTab(root: HTMLElement, tab: PhoneTab): void {
  if (tab === "devices") {
    void mountDevices(
      root,
      () => {
        void mountPhone(root, "send");
      },
      (nextTab) => navigateTab(root, nextTab),
    );
    return;
  }
  if (tab === "settings") {
    void mountPhoneSettings(root, (nextTab) => navigateTab(root, nextTab));
    return;
  }
  void mountPhone(root, "send");
}

function PhoneSendScreen({
  initialKnown,
  pending,
  onPickImages,
  onResumeDrafts,
  onDiscardDrafts,
  onSelectTab,
}: {
  initialKnown: Destination[];
  pending: Draft[] | null;
  onPickImages: (imagesBase64: string[], targetPcIds: string[]) => void;
  onResumeDrafts: () => void;
  onDiscardDrafts: () => void;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const [known, setKnown] = React.useState<Destination[]>(initialKnown);
  const [targetIds, setTargetIds] = React.useState<string[]>(() => initialTargets(initialKnown));
  const [showAllPcs, setShowAllPcs] = React.useState<boolean>(false);
  const [discardOpen, setDiscardOpen] = React.useState<boolean>(false);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  // null = clipboard card closed; a string (possibly empty) = preview open.
  const [clip, setClip] = React.useState<string | null>(null);
  const [clipSending, setClipSending] = React.useState<boolean>(false);
  const [clipError, setClipError] = React.useState<string>("");
  const clipBatchRef = React.useRef<string | null>(null);
  const clipInputRef = React.useRef<HTMLTextAreaElement>(null);

  const openClipboard = React.useCallback(async () => {
    clipboardRequested = false;
    clipBatchRef.current = null;
    setClipError("");
    let text = await readClipboard();
    if (!text) {
      // Right after the app comes to the front Android may not have given it focus yet.
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      text = await readClipboard();
    }
    setClip(text);
  }, []);

  React.useEffect(() => {
    if (clipboardRequested) {
      void openClipboard();
    }
    const onRequest = () => void openClipboard();
    window.addEventListener(CLIPBOARD_EVENT, onRequest);
    return () => window.removeEventListener(CLIPBOARD_EVENT, onRequest);
  }, [openClipboard]);

  const sendClipboardText = async (): Promise<void> => {
    if (targets.length === 0 || clip === null) {
      return;
    }
    const batchId = clipBatchRef.current ?? newTextBatchId();
    clipBatchRef.current = batchId; // a retry of the same text reuses it, so no computer stores it twice
    setClipSending(true);
    setClipError("");
    const text = clip;
    const { ok, failed } = await sendToEach(targets, (pc) => api.sendText(pc.pcId, batchId, text));
    setClipSending(false);
    if (ok.length > 0) {
      showToast(en.textSent(joinNames(ok)));
      buzzIfEnabled();
    }
    if (failed.length === 0) {
      clipBatchRef.current = null;
      setClip(null);
      return;
    }
    setClipError(
      failed.length === 1 && failed[0].error
        ? failed[0].error
        : en.didNotReceiveText(joinNames(failed.map((item) => item.pc))),
    );
  };

  React.useEffect(() => {
    let cancelled = false;
    void api
      .discoverDestinations()
      .then((discovered) => {
        if (!cancelled && discovered.length > 0) {
          setKnown(discovered);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const targets = known.filter((pc) => targetIds.includes(pc.pcId));
  const toggleTarget = (pcId: string): void => {
    setTargetIds((current) => {
      const next = current.includes(pcId)
        ? current.filter((id) => id !== pcId)
        : [...current, pcId];
      saveTargets(next);
      return next;
    });
  };
  // Online first; only the first few unless the list is opened, but a ticked one always shows.
  const sortedPcs = [...known.filter((pc) => pc.online), ...known.filter((pc) => !pc.online)];
  const shownPcs = showAllPcs
    ? sortedPcs
    : sortedPcs.filter(
        (pc, index) => index < DESTINATIONS_SHOWN || targetIds.includes(pc.pcId),
      );

  return (
    <PhoneFrame activeTab="send" onSelectTab={onSelectTab}>
      <header className="flex min-h-9 items-center gap-2.5">
        <h1 className="m-0 text-lg font-semibold text-foreground">
          {en.appName}
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1">
        {pending && pending.length > 0 ? (
          <Card className="flex items-center gap-2.5 rounded-2xl border-0 bg-accent px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <ArrowUpFromLine className="h-4 w-4" />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold text-foreground">
                {en.draftsWaiting(pending.length)}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {en.draftsWaitingHint}
              </span>
            </div>
            <Button
              variant="default"
              size="sm"
              className="shrink-0"
              onClick={onResumeDrafts}
            >
              {en.continueSend}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={en.discard}
              title={en.discard}
              className="h-8 w-8 shrink-0 rounded-full"
              onClick={() => setDiscardOpen(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </Card>
        ) : null}

        {known.length > 0 ? (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {en.destinationLabel}
              </span>
              <Card className="flex flex-col gap-0.5 border-0 bg-muted p-1.5 shadow-none">
                {shownPcs.map((pc) => {
                  const checked = targetIds.includes(pc.pcId);
                  return (
                    <label
                      key={pc.pcId}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2.5 active:bg-secondary"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleTarget(pc.pcId)}
                        aria-label={pc.name}
                      />
                      <Laptop
                        aria-hidden="true"
                        className={cn(
                          "h-5 w-5 shrink-0",
                          pc.online ? "text-success" : "text-muted-foreground/60",
                        )}
                      />
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate text-sm font-semibold",
                          pc.online ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {pc.name}
                      </span>
                      <span className="sr-only">
                        {pc.online ? en.onlineStatus : en.offlineStatus}
                      </span>
                    </label>
                  );
                })}
                {sortedPcs.length > shownPcs.length || showAllPcs ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setShowAllPcs((open) => !open)}
                  >
                    {showAllPcs ? en.showFewer : en.showAllComputers(sortedPcs.length)}
                  </Button>
                ) : null}
              </Card>
            </div>

            {/* Toss controls sit low on the screen, where the thumb is. */}
            <div className="mt-auto flex flex-col gap-3">
              {clip === null ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="gap-2 rounded-2xl"
                  onClick={() => void openClipboard()}
                >
                  <ClipboardPaste className="h-4 w-4" />
                  {en.sendClipboard}
                </Button>
              ) : (
                <Card className="flex flex-col gap-2.5 rounded-2xl border-0 bg-muted p-3 shadow-none">
                  <div className="relative">
                    <textarea
                      ref={clipInputRef}
                      value={clip}
                      rows={5}
                      placeholder={en.clipboardPlaceholder}
                      aria-label={en.sendClipboard}
                      onChange={(event) => {
                        clipBatchRef.current = null; // edited text is a new message
                        setClip(event.target.value);
                      }}
                      className="block w-full resize-none rounded-xl border-0 bg-background p-2.5 pb-9 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    />
                    {clip.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="absolute right-1.5 bottom-1.5 text-muted-foreground"
                        disabled={clipSending}
                        onClick={() => {
                          clipBatchRef.current = null;
                          setClip("");
                          setClipError("");
                          clipInputRef.current?.focus();
                        }}
                      >
                        {en.clear}
                      </Button>
                    ) : null}
                  </div>
                  {clipError ? (
                    <p className="m-0 text-xs text-destructive">{clipError}</p>
                  ) : null}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={clipSending}
                      onClick={() => {
                        clipBatchRef.current = null;
                        setClip(null);
                        setClipError("");
                      }}
                    >
                      {en.cancel}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={clipSending || clip.trim().length === 0 || targets.length === 0}
                      onClick={() => void sendClipboardText()}
                    >
                      {clipSending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        en.sendText
                      )}
                    </Button>
                  </div>
                </Card>
              )}

              <Input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  if (files.length === 0) {
                    return;
                  }
                  void filesToBase64(files).then((encoded) => {
                    if (encoded.length > 0) {
                      onPickImages(encoded, targetIds);
                    }
                  });
                }}
              />

              <Card
                role="button"
                tabIndex={0}
                aria-disabled={targets.length === 0}
                onClick={() => {
                  if (targets.length > 0) {
                    fileInputRef.current?.click();
                  }
                }}
                onKeyDown={(event) => {
                  if ((event.key === "Enter" || event.key === " ") && targets.length > 0) {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={cn(
                  "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-0 bg-accent px-5 py-9 text-center transition-transform focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.99]",
                  targets.length === 0 && "cursor-not-allowed opacity-50",
                )}
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ArrowUpFromLine className="h-6 w-6" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold text-foreground">
                    {en.pickImages}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {targets.length === 0 ? en.pickDestinationFirst : en.tapToPickPhotos}
                  </span>
                </div>
              </Card>
            </div>
          </>
        ) : (
          <Card className="my-auto flex flex-col items-center justify-center gap-3 rounded-2xl border-0 bg-muted px-5 py-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
              <Laptop className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium text-foreground">
              {en.pairComputerPrompt}
            </p>
            <Button
              variant="default"
              size="lg"
              onClick={() => onSelectTab("devices")}
            >
              {en.openDevicesButton}
            </Button>
          </Card>
        )}
      </div>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{en.discardDraftsTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {pending ? en.discardDraftsDescription(pending.length) : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                onDiscardDrafts();
              }}
            >
              {en.discard}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PhoneFrame>
  );
}

async function consumeInbox(
  root: HTMLElement,
  fromEvent: boolean,
  tab: PhoneTab = "send",
): Promise<void> {
  if (takingInbox) {
    return;
  }
  takingInbox = true;
  let shared: string[] = [];
  try {
    shared = await api.takeSharedImages();
  } catch (error) {
    note(errorText(error));
  } finally {
    takingInbox = false;
  }
  if (shared.length === 0) {
    if (fromEvent) {
      return;
    }
    if (tab !== "send") {
      navigateTab(root, tab);
      return;
    }
    if (resumeOnce && pendingDrafts) {
      resumeOnce = false;
      await chooseDestination(root, pendingDrafts);
      return;
    }
    const known = await api.listKnownPcs();
    const reactRoot = getOrCreateRoot(root);
    reactRoot.render(
      <PhoneSendScreen
        initialKnown={known}
        pending={pendingDrafts}
        onPickImages={(pickedBase64, targetPcIds) => {
          void openDrafts(root, pickedBase64, targetPcIds);
        }}
        onResumeDrafts={() => {
          const drafts = pendingDrafts;
          if (!drafts || drafts.length === 0) {
            return;
          }
          keepDrafts([]);
          void chooseDestination(root, drafts);
        }}
        onDiscardDrafts={() => {
          keepDrafts([]);
          void mountPhone(root, "send");
        }}
        onSelectTab={(nextTab) => navigateTab(root, nextTab)}
      />,
    );
    return;
  }
  await openDrafts(root, shared);
}

export async function openDrafts(
  root: HTMLElement,
  imagesBase64: string[],
  preferredPcIds?: string[],
): Promise<void> {
  const existing = pendingDrafts ?? [];
  keepDrafts([]);
  const stamp = Date.now();
  const drafts: Draft[] = [
    ...existing,
    ...imagesBase64.map((pngBase64, index) => ({
      id: `draft-${stamp}-${index}`,
      pngBase64,
      marks: [],
    })),
  ];
  await chooseDestination(root, drafts, preferredPcIds);
}

async function chooseDestination(
  root: HTMLElement,
  drafts: Draft[],
  // the computers ticked on the Send screen; shared or resumed images go to the same ones
  preferredPcIds: string[] = loadTargets(),
): Promise<void> {
  const known = await api.listKnownPcs();
  const chosen = known.filter((item) => preferredPcIds.includes(item.pcId));
  if (chosen.length > 0) {
    openEditor(root, drafts, chosen.map((pc) => ({ ...pc, online: true })), known);
    return;
  }
  if (known.length === 1) {
    openEditor(root, drafts, [{ ...known[0], online: true }], known);
    void api.discoverDestinations().then((discovered) => {
      const updated = discovered.find((item) => item.pcId === known[0].pcId);
      const dot = root.querySelector<HTMLElement>(".editor .dot");
      if (dot && updated) {
        dot.classList.toggle("on", updated.online);
      }
    });
    return;
  }
  const destinations = await api.discoverDestinations();
  const online = destinations.filter((pc) => pc.online);
  if (online.length === 0) {
    if (known.length > 0) {
      openEditor(root, drafts, [known[0]], known);
      return;
    }
    showOffline(root, drafts);
    return;
  }
  if (online.length === 1) {
    openEditor(root, drafts, [online[0]], destinations);
    return;
  }
  showSheet(root, drafts, online, destinations);
}

function showSheet(
  root: HTMLElement,
  drafts: Draft[],
  online: Destination[],
  all: Destination[],
): void {
  const reactRoot = getOrCreateRoot(root);
  const leaveWithDrafts = (tab: PhoneTab): void => {
    keepDrafts(drafts);
    navigateTab(root, tab);
  };
  reactRoot.render(
    <PhoneFrame activeTab="send" onSelectTab={leaveWithDrafts}>
      <header className="flex min-h-9 items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.back}
          title={en.back}
          className="h-11 w-11 shrink-0 rounded-full"
          onClick={() => {
            keepDrafts(drafts);
            void mountPhone(root, "send");
          }}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="m-0 text-lg font-semibold text-foreground">
          {en.sendTo}
        </h1>
      </header>
      <Card className="flex flex-col gap-1.5 border-0 bg-muted p-3 shadow-none">
        {online.map((pc) => (
          <Button
            key={pc.pcId}
            variant="secondary"
            className="w-full justify-start gap-2.5"
            disabled={!pc.online}
            onClick={() => openEditor(root, drafts, [pc], all)}
          >
            <Laptop className="h-4 w-4 text-primary" />
            <span>{pc.name}</span>
          </Button>
        ))}
      </Card>
      <p className="mt-auto text-center text-xs text-muted-foreground">
        {en.draftsWaiting(drafts.length)}
      </p>
    </PhoneFrame>,
  );
}

function showOffline(root: HTMLElement, drafts: Draft[]): void {
  const reactRoot = getOrCreateRoot(root);
  const leaveWithDrafts = (tab: PhoneTab): void => {
    keepDrafts(drafts);
    navigateTab(root, tab);
  };
  reactRoot.render(
    <PhoneFrame activeTab="send" onSelectTab={leaveWithDrafts}>
      <Card className="my-auto flex flex-col items-center gap-3 border-0 bg-muted p-5 text-center">
        <p className="text-sm font-medium text-foreground">{en.offline}</p>
        <div className="flex w-full gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            onClick={() => {
              void chooseDestination(root, drafts);
            }}
          >
            {en.retry}
          </Button>
          <Button
            variant="default"
            className="flex-1"
            onClick={() => {
              keepDrafts(drafts);
              void mountDevices(
                root,
                () => {
                  void chooseDestination(root, drafts);
                },
                (tab) => navigateTab(root, tab),
              );
            }}
          >
            {en.scanQr}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            keepDrafts(drafts);
            void mountPhone(root, "send");
          }}
        >
          {en.cancel}
        </Button>
      </Card>
    </PhoneFrame>,
  );
}

function openEditor(
  root: HTMLElement,
  drafts: Draft[],
  pcs: Destination[],
  all: Destination[],
): void {
  keepDrafts(drafts);
  const names = joinNames(pcs);
  mountEditor(root, {
    pcName: names,
    online: pcs.some((pc) => pc.online),
    drafts,
    onChange: () => keepDrafts(drafts),
    onClose: () => {
      keepDrafts(drafts);
      void mountPhone(root, "send");
    },
    onSwitch: () => showSheet(root, drafts, all, all),
    onSend: async (batchId, images) => {
      // The same batch id to every computer: a retry after a partial failure is not stored twice.
      const { ok, failed } = await sendToEach(pcs, (pc) => api.sendBatch(pc.pcId, batchId, images));
      if (ok.length > 0) {
        buzzIfEnabled();
      }
      if (failed.length > 0) {
        const message =
          failed.length === 1 && failed[0].error
            ? failed[0].error
            : en.didNotReceive(joinNames(failed.map((item) => item.pc)));
        note(message);
        throw new Error(message);
      }
      keepDrafts([]);
      const sentMsg =
        images.length === 1 ? `${en.sentTo(names)} · ${en.pasteReady}` : en.sentTo(names);
      note(sentMsg);
      showToast(sentMsg);
      void mountPhone(root, "send");
    },
  });
}
