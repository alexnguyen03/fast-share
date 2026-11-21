import * as React from "react";
import {
  ArrowUpFromLine,
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
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
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
import { pickTargets } from "./target-picker";

let inboxBound = false;
let takingInbox = false;

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
  onPickImages: (imagesBase64: string[]) => void;
  onResumeDrafts: () => void;
  onDiscardDrafts: () => void;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const known = initialKnown;
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
    if (clip === null) {
      return;
    }
    setClipSending(true);
    setClipError("");
    const targets = await pickTargets();
    if (!targets) {
      setClipSending(false);
      return;
    }
    const batchId = clipBatchRef.current ?? newTextBatchId();
    clipBatchRef.current = batchId; // a retry of the same text reuses it, so no computer stores it twice
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

  return (
    <PhoneFrame activeTab="send" onSelectTab={onSelectTab}>
      <header className="flex min-h-9 items-center gap-2.5">
        <h1 className="m-0 text-lg font-semibold text-foreground">
          {en.appName}
        </h1>
      </header>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pt-1 pb-1">
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
            <div className="flex flex-col gap-3">
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
                      onPickImages(encoded);
                    }
                  });
                }}
              />

              <Card
                role="button"
                tabIndex={0}
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className="flex h-[50dvh] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-0 bg-accent px-5 text-center transition-transform focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none active:scale-[0.99]"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <ArrowUpFromLine className="h-6 w-6" />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-base font-semibold text-foreground">
                    {en.pickImages}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {en.tapToPickPhotos}
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

      {clip !== null ? (
        <div
          data-no-swipe
          className="fixed inset-0 z-40 flex flex-col bg-black/45 px-4 pt-[max(44px,calc(8px+env(safe-area-inset-top,0px)))]"
          onClick={(event) => {
            // a tap on the dimmed background closes it, like Cancel
            if (event.target === event.currentTarget && !clipSending) {
              clipBatchRef.current = null;
              setClip(null);
              setClipError("");
            }
          }}
        >
          <Card className="flex flex-col gap-2.5 rounded-2xl border-0 bg-muted p-3 shadow-xl">
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
                disabled={clipSending || clip.trim().length === 0}
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
        </div>
      ) : null}

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
        onPickImages={(pickedBase64) => {
          void openDrafts(root, pickedBase64);
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
  await chooseDestination(root, drafts);
}

async function chooseDestination(root: HTMLElement, drafts: Draft[]): Promise<void> {
  const known = await api.listKnownPcs();
  if (known.length === 0) {
    showOffline(root, drafts);
    return;
  }
  openEditor(root, drafts);
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

function openEditor(root: HTMLElement, drafts: Draft[]): void {
  keepDrafts(drafts);
  let targets: Destination[] = [];
  mountEditor(root, {
    drafts,
    onChange: () => keepDrafts(drafts),
    onClose: () => {
      keepDrafts(drafts);
      void mountPhone(root, "send");
    },
    onDiscardAll: () => {
      keepDrafts([]);
      void mountPhone(root, "send");
    },
    chooseTargets: async () => {
      targets = (await pickTargets()) ?? [];
      return targets.length > 0;
    },
    onSend: async (batchId, images) => {
      // The same batch id to every computer: a retry after a partial failure is not stored twice.
      const { ok, failed } = await sendToEach(targets, (pc) => api.sendBatch(pc.pcId, batchId, images));
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
      const names = joinNames(ok);
      const sentMsg =
        images.length === 1 ? `${en.sentTo(names)} · ${en.pasteReady}` : en.sentTo(names);
      note(sentMsg);
      showToast(sentMsg);
      void mountPhone(root, "send");
    },
  });
}
