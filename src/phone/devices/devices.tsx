import * as React from "react";
import { ChevronLeft, Laptop, QrCode, RefreshCw } from "lucide-react";
import {
  api,
  type Destination,
  type NearbyPc,
  type PairResult,
} from "../../shared/commands";
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
  AlertDialogTrigger,
} from "../../shared/ui/alert-dialog";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { PhoneFrame, type PhoneTab } from "../frame";
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

async function finishPair(
  action: () => Promise<PairResult>,
  refresh: () => Promise<void>,
): Promise<boolean> {
  let result: PairResult;
  try {
    result = await action();
  } catch (error) {
    const msg = errorText(error);
    note(msg);
    showToast(msg);
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
  if (result.status === "needs_forget") {
    note(en.needsForgetOnComputer);
    showToast(en.needsForgetOnComputer);
    await refresh();
    return false;
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
    showToast(en.pairFailed);
    await refresh();
    return false;
  }
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await wait(1000);
    try {
      const next = await api.pollPair(pc.pcId);
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
      showToast(msg);
      await refresh();
      return false;
    }
    if (attempt % 5 === 0) {
      note(en.waiting);
      await refresh();
    }
  }
  note(en.timedOut);
  showToast(en.timedOut);
  await refresh();
  return false;
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
  const [scanning, setScanning] = React.useState<boolean>(false);
  const [codeValue, setCodeValue] = React.useState<string>("");
  const [addressValue, setAddressValue] = React.useState<string>("");
  const [noticeText, setNoticeText] = React.useState<string>(latestNote());
  const cancelScanRef = React.useRef<(() => Promise<void>) | null>(null);

  const syncHome = React.useCallback(async () => {
    setScanning(false);
    document.documentElement.classList.remove("camera-open");
    const nextKnown = await api.listKnownPcs();
    setKnown(nextKnown);
    setNoticeText(latestNote());
  }, []);

  const refreshNearby = React.useCallback(async () => {
    try {
      const [nextKnown, list] = await Promise.all([
        api.listKnownPcs(),
        api.discoverNearbyPcs(),
      ]);
      setKnown(nextKnown);
      setNearbyList(list);
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
      const permission = await scanner.requestPermissions();
      if (permission !== "granted") {
        note(en.cameraDenied);
        showToast(en.cameraDenied);
        return;
      }
      note(en.scanning);
      setNoticeText(en.scanning);
      const scanned = await scanner.scan({
        windowed: true,
        cameraDirection: "back",
        formats: [scanner.Format.QRCode],
      });
      document.documentElement.classList.remove("camera-open");
      note(en.qrRead);
      await syncHome();
      const paired = await finishPair(
        () => api.pairWithQr(scanned.content),
        syncHome,
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
      if (leave) {
        document.documentElement.classList.remove("camera-open");
        return;
      }
      await syncHome();
    }
  }

  async function submitCode(
    event: React.FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    if (codeValue.length !== 6) {
      return;
    }
    note(en.qrRead);
    await syncHome();
    const paired = await finishPair(
      () => api.pairWithCode(codeValue, addressValue),
      syncHome,
    );
    if (paired && onPaired) {
      onPaired();
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
        <h1 className="m-0 text-center text-[1.12rem] font-semibold text-foreground">
          {en.devicesTitle}
        </h1>
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.refreshNearby}
          title={en.refreshNearby}
          onClick={() => {
            void refreshNearby();
          }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pt-1">
        {noticeText ? (
          <p className="px-1 text-xs font-medium text-muted-foreground">
            {noticeText}
          </p>
        ) : null}

        <h2 className="mt-1 mb-0.5 text-sm font-semibold text-foreground">
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
                <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-foreground">
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

        <h2 className="mt-1 mb-0.5 text-sm font-semibold text-foreground">
          {en.inThisLan}
        </h2>
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
                className="flex min-h-10 cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 transition-colors hover:bg-secondary/60"
              >
                <Laptop className="h-5 w-5 shrink-0 text-foreground" />
                <span className="min-w-0 flex-1 truncate text-[0.95rem] font-medium text-foreground">
                  {item.name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {`${item.host}:${item.port}`}
                </span>
              </div>
            ))
          )}
        </Card>

        <h2 className="mt-1 mb-0.5 text-sm font-semibold text-foreground">
          {en.pairComputerTitle}
        </h2>
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

          <form
            onSubmit={(e) => void submitCode(e)}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder={en.pairCodePlaceholder}
                value={codeValue}
                onChange={(event) =>
                  setCodeValue(
                    event.target.value.replace(/\D+/g, "").slice(0, 6),
                  )
                }
                className="text-center font-semibold tracking-[0.14em]"
              />
              <Button
                type="submit"
                variant="secondary"
                className="shrink-0"
                disabled={codeValue.length !== 6}
              >
                {en.pairWithCodeButton}
              </Button>
            </div>
            <Input
              type="text"
              placeholder={en.lanAddressPlaceholder}
              aria-label={en.lanAddressLabel}
              value={addressValue}
              onChange={(event) => setAddressValue(event.target.value)}
            />
          </form>
        </Card>
      </div>
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
