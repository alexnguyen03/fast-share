import * as React from "react";
import { ArrowUpFromLine, CheckCircle2, Laptop } from "lucide-react";
import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { applyTheme } from "../../shared/settings";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../shared/ui/select";
import { showToast } from "../../shared/ui/toast";
import { filesToBase64, mountDevices } from "../devices/devices";
import { mountEditor, type Draft } from "../editor/editor";
import { PhoneFrame, type PhoneTab } from "../frame";
import { errorText, note } from "../log";
import { mountPhoneSettings } from "../settings/settings";

let inboxBound = false;
let takingInbox = false;
let selectedPcIdState: string | null = null;

export async function mountPhone(
  root: HTMLElement,
  initialTab: PhoneTab = "send",
): Promise<void> {
  const settings = await api.getSettings();
  applyTheme(settings.theme);

  if (!inboxBound) {
    inboxBound = true;
    window.addEventListener("fast-share-inbox", () => {
      void consumeInbox(root, true, initialTab);
    });
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
  onPickImages,
  onSelectTab,
}: {
  initialKnown: Destination[];
  onPickImages: (imagesBase64: string[], targetPcId?: string) => void;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const [known, setKnown] = React.useState<Destination[]>(initialKnown);
  const [selectedPcId, setSelectedPcId] = React.useState<string>(
    selectedPcIdState && initialKnown.some((p) => p.pcId === selectedPcIdState)
      ? selectedPcIdState
      : (initialKnown[0]?.pcId ?? ""),
  );
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

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

  const currentPc =
    known.find((p) => p.pcId === selectedPcId) ?? known[0] ?? null;

  return (
    <PhoneFrame activeTab="send" onSelectTab={onSelectTab}>
      <header className="flex min-h-9 items-center justify-between gap-2.5">
        <h1 className="m-0 text-[1.12rem] font-semibold text-foreground">
          {en.appName}
        </h1>
        {known.length > 0 ? (
          <Select
            value={currentPc?.pcId ?? ""}
            onValueChange={(value) => {
              selectedPcIdState = value;
              setSelectedPcId(value);
            }}
          >
            <SelectTrigger aria-label={en.knownComputers}>
              <SelectValue placeholder={en.knownComputers} />
            </SelectTrigger>
            <SelectContent>
              {known.map((pc) => (
                <SelectItem key={pc.pcId} value={pc.pcId}>
                  {pc.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1">
        {known.length > 0 ? (
          <>
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
                    onPickImages(encoded, currentPc?.pcId);
                  }
                });
              }}
            />

            <Card
              role="button"
              tabIndex={0}
              onClick={() => fileInputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-0 bg-accent px-5 py-9 text-center transition-transform active:scale-[0.99]"
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

            {currentPc ? (
              <div className="flex flex-col gap-1.5">
                <span className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {en.destinationLabel}
                </span>
                <Card className="flex items-center justify-between border-0 bg-muted px-3.5 py-3 shadow-none">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={
                        currentPc.online ? "dot on shrink-0" : "dot shrink-0"
                      }
                    />
                    <Laptop className="h-4 w-4 shrink-0 text-foreground" />
                    <span className="truncate text-sm font-semibold text-foreground">
                      {currentPc.name}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {currentPc.online ? en.onlineStatus : en.offlineStatus}
                  </span>
                </Card>
              </div>
            ) : null}
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
    const known = await api.listKnownPcs();
    const reactRoot = getOrCreateRoot(root);
    reactRoot.render(
      <PhoneSendScreen
        initialKnown={known}
        onPickImages={(pickedBase64, targetPcId) => {
          void openDrafts(root, pickedBase64, targetPcId);
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
  preferredPcId?: string,
): Promise<void> {
  const drafts: Draft[] = imagesBase64.map((pngBase64, index) => ({
    id: `draft-${index}`,
    pngBase64,
    marks: [],
  }));
  await chooseDestination(root, drafts, preferredPcId);
}

async function chooseDestination(
  root: HTMLElement,
  drafts: Draft[],
  preferredPcId?: string,
): Promise<void> {
  const known = await api.listKnownPcs();
  if (preferredPcId) {
    const chosen = known.find((item) => item.pcId === preferredPcId);
    if (chosen) {
      openEditor(root, drafts, { ...chosen, online: true }, known);
      return;
    }
  }
  if (known.length === 1) {
    openEditor(root, drafts, { ...known[0], online: true }, known);
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
      openEditor(root, drafts, known[0], known);
      return;
    }
    showOffline(root, drafts);
    return;
  }
  if (online.length === 1) {
    openEditor(root, drafts, online[0], destinations);
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
  reactRoot.render(
    <PhoneFrame
      activeTab="send"
      onSelectTab={(tab) => navigateTab(root, tab)}
    >
      <header className="flex min-h-9 items-center justify-between">
        <h1 className="m-0 text-[1.12rem] font-semibold text-foreground">
          {en.sendTo}
        </h1>
      </header>
      <Card className="flex flex-col gap-1.5 border-0 bg-muted p-3 shadow-none">
        {online.map((pc) => (
          <Button
            key={pc.pcId}
            variant="secondary"
            className="w-full justify-start gap-2.5"
            onClick={() => openEditor(root, drafts, pc, all)}
          >
            <Laptop className="h-4 w-4 text-primary" />
            <span>{pc.name}</span>
          </Button>
        ))}
      </Card>
    </PhoneFrame>,
  );
}

function showOffline(root: HTMLElement, drafts: Draft[]): void {
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <PhoneFrame
      activeTab="send"
      onSelectTab={(tab) => navigateTab(root, tab)}
    >
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
      </Card>
    </PhoneFrame>,
  );
}

function openEditor(
  root: HTMLElement,
  drafts: Draft[],
  pc: Destination,
  all: Destination[],
): void {
  mountEditor(root, {
    pcName: pc.name,
    online: pc.online,
    drafts,
    onClose: () => {
      void mountPhone(root, "send");
    },
    onSwitch: () =>
      showSheet(
        root,
        drafts,
        all.filter((item) => item.online),
        all,
      ),
    onSend: async (batchId, images) => {
      try {
        await api.sendBatch(pc.pcId, batchId, images);
        const sentMsg =
          images.length === 1
            ? `${en.sentTo(pc.name)} · ${en.pasteReady}`
            : en.sentTo(pc.name);
        note(sentMsg);
        showToast(sentMsg);
        const reactRoot = getOrCreateRoot(root);
        reactRoot.render(
          <PhoneFrame
            activeTab="send"
            onSelectTab={(tab) => navigateTab(root, tab)}
          >
            <Card className="my-auto flex flex-col items-center gap-3 rounded-2xl border-0 bg-accent px-5 py-8 text-center">
              <CheckCircle2 className="h-10 w-10 text-primary" />
              <p className="text-base font-semibold text-foreground">
                {images.length === 1
                  ? `${en.sentTo(pc.name)} ${en.pasteReady}`
                  : en.sentTo(pc.name)}
              </p>
              <Button
                variant="default"
                size="lg"
                className="mt-1 w-full"
                onClick={() => {
                  void mountPhone(root, "send");
                }}
              >
                {en.back}
              </Button>
            </Card>
          </PhoneFrame>,
        );
      } catch (error) {
        const message = errorText(error);
        note(message || en.didNotReceive(pc.name));
        throw new Error(message || en.didNotReceive(pc.name));
      }
    },
  });
}
