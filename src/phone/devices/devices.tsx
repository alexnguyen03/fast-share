import * as React from "react";
import { ChevronLeft, CircleHelp, Laptop, Loader2, QrCode } from "lucide-react";
import {
  api,
  type Destination,
  type LanInfo,
  type NearbyPc,
  type PairResult,
} from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { LanStatusCard, lanSummary } from "../../shared/lan-status";
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
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog";
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast, Toaster } from "../../shared/ui/toast";
import { PhoneFrame, type PhoneTab } from "../frame";
import { PullToRefresh } from "../pull-to-refresh";
import { groupLabelClass } from "../settings-group";
import { errorText, latestNote, note } from "../log";

function runningInApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export async function filesToBase64(files: File[]): Promise<string[]> {
  const encoded = await Promise.all(
    files.map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const dataUrl =
              typeof reader.result === "string" ? reader.result : "";
            const comma = dataUrl.indexOf(",");
            resolve(comma >= 0 ? dataUrl.slice(comma + 1) : "");
          };
          reader.onerror = () => reject(new Error("file"));
          reader.readAsDataURL(file);
        }),
    ),
  );
  return encoded.filter((item) => item.length > 0);
}

type PairControl = {
  onWaiting?: (waiting: boolean) => void;
  onCode?: (code: string | null) => void;
  shouldStop?: () => boolean;
};

async function finishPair(
  action: () => Promise<PairResult>,
  refresh: () => Promise<void>,
  control: PairControl = {},
): Promise<boolean> {
  const { onWaiting, onCode, shouldStop } = control;
  let result: PairResult;
  try {
    result = await action();
  } catch (error) {
    const msg = errorText(error);
    note(msg);
    showToast(msg, "destructive");
    await refresh();
    return false;
  }
  const known = await api.listKnownPcs();
  const pc = known[0];
  if (result.status === "trusted") {
    const msg = en.pairedWith(pc?.name ?? en.knownComputers);
    note(msg);
    showToast(msg);
    await refresh();
    return true;
  }
  if (result.status === "rejected") {
    note(en.rejected);
    showToast(en.rejected);
    await refresh();
    return false;
  }
  note(en.waiting);
  await refresh();
  if (!pc) {
    note(en.pairFailed);
    showToast(en.pairFailed, "destructive");
    await refresh();
    return false;
  }
  onWaiting?.(true);
  try {
    // The computer keeps a request for two minutes.
    for (let attempt = 1; attempt <= 125; attempt += 1) {
      if (shouldStop?.()) {
        note(en.pairingCancelled);
        showToast(en.pairingCancelled);
        await refresh();
        return false;
      }
      await wait(1000);
      if (shouldStop?.()) {
        note(en.pairingCancelled);
        showToast(en.pairingCancelled);
        await refresh();
        return false;
      }
      try {
        const next = await api.pollPair(pc.pcId);
        onCode?.(next.sas ?? null);
        if (next.status === "trusted") {
          const msg = en.pairedWith(pc.name);
          note(msg);
          showToast(msg);
          await refresh();
          return true;
        }
        if (next.status === "rejected") {
          note(en.rejected);
          showToast(en.rejected);
          await refresh();
          return false;
        }
      } catch (error) {
        const msg = errorText(error);
        note(msg);
        showToast(msg, "destructive");
        await refresh();
        return false;
      }
      if (attempt % 5 === 0) {
        note(en.waiting);
        await refresh();
      }
    }
    note(en.timedOut);
    showToast(en.timedOut, "destructive");
    await refresh();
    return false;
  } finally {
    onWaiting?.(false);
    onCode?.(null);
  }
}

export function PhoneDevicesScreen({
  initialKnown,
  onPaired,
  onSelectTab,
}: {
  initialKnown: Destination[];
  onPaired?: () => void;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const [known, setKnown] = React.useState<Destination[]>(initialKnown);
  const [nearbyList, setNearbyList] = React.useState<NearbyPc[]>([]);
  const [lanInfo, setLanInfo] = React.useState<LanInfo | null>(null);
  const [scanning, setScanning] = React.useState<boolean>(false);
  const [compareCode, setCompareCode] = React.useState<string | null>(null);
  const [addressValue, setAddressValue] = React.useState<string>("");
  const [noticeText, setNoticeText] = React.useState<string>(latestNote());
  const [showOtherPairing, setShowOtherPairing] = React.useState<boolean>(false);
  const [pairing, setPairing] = React.useState<boolean>(false);
  const [helpOpen, setHelpOpen] = React.useState<boolean>(false);
  const [wifiName, setWifiName] = React.useState<string>("");
  const cancelScanRef = React.useRef<(() => Promise<void>) | null>(null);
  const stopPairingRef = React.useRef<boolean>(false);
  const pairControl = React.useMemo<PairControl>(
    () => ({
      onWaiting: setPairing,
      onCode: setCompareCode,
      shouldStop: () => stopPairingRef.current,
    }),
    [],
  );
  const beginPairing = React.useCallback(() => {
    stopPairingRef.current = false;
    setPairing(false);
  }, []);

  // Read again when the app comes back, e.g. after the user answered the location prompt.
  React.useEffect(() => {
    const read = (): void => {
      void api.wifiName().then(setWifiName).catch(() => setWifiName(""));
    };
    read();
    window.addEventListener("focus", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      window.removeEventListener("focus", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);

  const syncHome = React.useCallback(async () => {
    setScanning(false);
    document.documentElement.classList.remove("camera-open");
    const nextKnown = await api.listKnownPcs();
    setKnown(nextKnown);
    setNoticeText(latestNote());
  }, []);

  const refreshNearby = React.useCallback(async () => {
    try {
      const [nextKnown, list, nextLan] = await Promise.all([
        api.listKnownPcs(),
        api.discoverNearbyPcs(),
        api.lanInfo(),
      ]);
      setKnown(nextKnown);
      setNearbyList(list);
      setLanInfo(nextLan);
    } catch {
      setNearbyList([]);
    }
  }, []);

  React.useEffect(() => {
    void refreshNearby();
  }, [refreshNearby]);

  async function startScan(): Promise<void> {
    if (scanning) {
      return;
    }
    setScanning(true);
    document.documentElement.classList.add("camera-open");
    let leave = false;
    if (!runningInApp()) {
      note(en.cameraUnavailable);
      setNoticeText(en.cameraUnavailable);
      cancelScanRef.current = async () => {
        await syncHome();
      };
      return;
    }
    try {
      const scanner = await import("@tauri-apps/plugin-barcode-scanner");
      cancelScanRef.current = () => scanner.cancel();
      let permission = "prompt";
      try {
        permission = await scanner.checkPermissions();
      } catch {
        permission = "prompt";
      }
      if (permission !== "granted") {
        permission = await scanner.requestPermissions();
      }
      if (permission !== "granted") {
        note(en.cameraDenied);
        showToast(en.cameraDenied, "destructive");
        return;
      }
      note(en.scanning);
      setNoticeText(en.scanning);
      window.__FAST_SHARE_ANDROID__?.setSystemBars(false, "#00000000");
      const scanned = await scanner.scan({
        windowed: true,
        cameraDirection: "back",
        formats: [scanner.Format.QRCode],
      });
      document.documentElement.classList.remove("camera-open");
      let target = "";
      try {
        const parsed = JSON.parse(scanned.content) as { host?: unknown };
        if (typeof parsed.host === "string") {
          target = parsed.host;
        }
      } catch {
        target = "";
      }
      const from = lanInfo ? lanSummary(lanInfo) : "";
      note(
        target
          ? en.contactingComputer(from || en.lanThisDevice, target)
          : en.qrRead,
      );
      await syncHome();
      beginPairing();
      const paired = await finishPair(
        () => api.pairWithQr(scanned.content),
        syncHome,
        pairControl,
      );
      if (paired && onPaired) {
        leave = true;
        onPaired();
      }
    } catch (error) {
      const message = errorText(error);
      note(message === "cancelled" ? en.scanCancelled : message);
    } finally {
      cancelScanRef.current = null;
      const settings = await api.getSettings().catch(() => null);
      if (settings) {
        applyTheme(settings.theme);
      }
      if (leave) {
        document.documentElement.classList.remove("camera-open");
        return;
      }
      await syncHome();
    }
  }

  async function connectTo(pcId?: string, address?: string): Promise<void> {
    const from = lanInfo ? lanSummary(lanInfo) : en.lanThisDevice;
    note(en.contactingComputer(from, address?.trim() || "mDNS"));
    await syncHome();
    beginPairing();
    const paired = await finishPair(
      () => api.pairNearby(pcId, address),
      syncHome,
      pairControl,
    );
    if (paired && onPaired) {
      onPaired();
    }
  }

  async function submitAddress(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (addressValue.trim()) {
      await connectTo(undefined, addressValue);
    }
  }

  if (scanning) {
    return (
      <section className="panel phone flex min-h-screen flex-col items-center justify-between px-4">
        <h1 className="text-lg font-semibold text-white">{en.scanQr}</h1>
        <div className="scan-hole" />
        <div className="flex w-full flex-col items-center gap-3">
          <p className="text-center text-sm text-white/90">
            {noticeText || en.scanning}
          </p>
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => {
              void cancelScanRef.current?.();
            }}
          >
            {en.cancel}
          </Button>
        </div>
        <Toaster />
      </section>
    );
  }

  return (
    <PhoneFrame activeTab="devices" onSelectTab={onSelectTab}>
      <header className="grid min-h-9 grid-cols-[36px_1fr_36px] items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.back}
          onClick={() => onSelectTab("send")}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <h1 className="m-0 text-center text-lg font-semibold text-foreground">
          {en.devicesTitle}
        </h1>
        <span aria-hidden="true" />
      </header>

      <PullToRefresh
        onRefresh={refreshNearby}
        className="-mx-1 flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-1 pt-1 pb-1"
      >
        {pairing ? (
          <Card className="flex flex-col gap-2 border-0 bg-accent p-3">
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <p className="text-sm font-semibold text-foreground">
                {en.waiting}
              </p>
            </div>
            {compareCode ? (
              <p className="text-center text-2xl font-bold tracking-[0.2em] text-foreground">
                {compareCode}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {compareCode ? en.compareCodeHint : en.waitAcceptHint}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                stopPairingRef.current = true;
              }}
            >
              {en.cancel}
            </Button>
          </Card>
        ) : null}
        {noticeText ? (
          <p className="px-1 text-xs font-medium text-muted-foreground">
            {noticeText}
          </p>
        ) : null}
        <h2 className={`mt-1 ${groupLabelClass}`}>
          {en.connected}
        </h2>
        <Card className="flex flex-col gap-1 border-0 bg-accent px-3 py-2 shadow-none">
          {known.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {en.noConnectedDevices}
            </p>
          ) : (
            known.map((pc) => (
              <div
                key={pc.pcId}
                className="flex min-h-10 items-center gap-2.5 py-1"
              >
                <Laptop className="h-5 w-5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                  {pc.name}
                </span>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="xs">
                      {en.forget}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>{en.forget}</AlertDialogTitle>
                      <AlertDialogDescription>
                        {en.forgetComputer(pc.name)}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
                      <AlertDialogAction
                        variant="destructive"
                        onClick={() => {
                          void api.forgetPc(pc.pcId).then(async () => {
                            const msg = en.forgotComputer(pc.name);
                            note(msg);
                            showToast(msg);
                            await syncHome();
                          });
                        }}
                      >
                        {en.forget}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))
          )}
        </Card>

        <div className="mt-1 mb-0.5 flex items-baseline justify-between gap-2">
          <h2 className={`min-w-0 truncate ${groupLabelClass}`}>
            {en.inThisLan}
            {wifiName ? (
              <span className="font-normal text-muted-foreground"> · {wifiName}</span>
            ) : null}
          </h2>
          {!wifiName && runningInApp() ? (
            <button
              type="button"
              className="shrink-0 text-xs font-medium text-primary"
              onClick={() => {
                void api.requestWifiPermission();
              }}
            >
              {en.showWifiName}
            </button>
          ) : null}
        </div>
        <Card className="flex flex-col gap-1 border-0 bg-muted px-3 py-2 shadow-none">
          {nearbyList.length === 0 ? (
            <p className="px-1 py-2 text-sm text-muted-foreground">
              {en.noLanDevices}
            </p>
          ) : (
            nearbyList.map((item) => (
              <div
                key={item.pcId}
                role="button"
                tabIndex={0}
                onClick={() => {
                  setAddressValue(`${item.host}:${item.port}`);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setAddressValue(`${item.host}:${item.port}`);
                  }
                }}
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none"
              >
                <Laptop className="h-5 w-5 shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 truncate text-base font-medium text-foreground">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {`${item.host}:${item.port}`}
                </span>
                {item.paired ? null : (
                  <Button
                    variant="default"
                    size="xs"
                    disabled={pairing}
                    onClick={(event) => {
                      event.stopPropagation();
                      void connectTo(item.pcId);
                    }}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {en.connect}
                  </Button>
                )}
              </div>
            ))
          )}
        </Card>

        <div className="mt-1 mb-0.5 flex items-center justify-between gap-2">
          <h2 className={groupLabelClass}>
            {en.pairComputerTitle}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            aria-label={en.pairHelpTitle}
            title={en.pairHelpTitle}
            className="h-7 w-7 rounded-full text-muted-foreground"
            onClick={() => setHelpOpen(true)}
          >
            <CircleHelp className="h-4.5 w-4.5" />
          </Button>
        </div>
        <Card className="flex flex-col gap-2.5 border-0 bg-muted p-3 shadow-none">
          <Button
            variant="default"
            size="lg"
            className="w-full"
            onClick={() => {
              void startScan();
            }}
          >
            <QrCode className="h-4 w-4" />
            <span>{en.scanQr}</span>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => setShowOtherPairing((prev) => !prev)}
          >
            {showOtherPairing ? en.hideOtherWaysToPair : en.otherWaysToPair}
          </Button>

          {showOtherPairing ? (
            <form
              onSubmit={(e) => void submitAddress(e)}
              className="flex flex-col gap-2"
            >
              <Input
                type="text"
                placeholder={en.lanAddressPlaceholder}
                aria-label={en.lanAddressLabel}
                value={addressValue}
                onChange={(event) => setAddressValue(event.target.value)}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={pairing || addressValue.trim().length === 0}
              >
                {en.connectToAddress}
              </Button>
            </form>
          ) : null}
        </Card>

      </PullToRefresh>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <div className="pr-8">
            <DialogTitle>{en.pairHelpTitle}</DialogTitle>
            <DialogDescription>{en.sameWifiHint}</DialogDescription>
          </div>
          <ol className="m-0 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-foreground">
            {en.pairHelpSteps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          {lanInfo ? <LanStatusCard info={lanInfo} /> : null}
        </DialogContent>
      </Dialog>
    </PhoneFrame>
  );
}

export async function mountDevices(
  root: HTMLElement,
  onPaired?: () => void,
  onSelectTab?: (tab: PhoneTab) => void,
): Promise<void> {
  const [known, settings] = await Promise.all([
    api.listKnownPcs(),
    api.getSettings(),
  ]);
  applyTheme(settings.theme);
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <PhoneDevicesScreen
      initialKnown={known}
      onPaired={onPaired}
      onSelectTab={
        onSelectTab ??
        (() => {
          onPaired?.();
        })
      }
    />,
  );
}
