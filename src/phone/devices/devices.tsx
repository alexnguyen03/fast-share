import * as React from "react";
import {
  api,
  type Destination,
  type NearbyPc,
  type PairResult,
} from "../../shared/commands";
import { en } from "../../shared/locales/en";
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
import { Input } from "../../shared/ui/input";
import { getOrCreateRoot } from "../../shared/ui/render";
import { errorText, latestNote, logText, note } from "../log";

function runningInApp(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function filesToBase64(files: File[]): Promise<string[]> {
  const results: string[] = [];
  for (const file of files) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(typeof reader.result === "string" ? reader.result : "");
      reader.onerror = () => reject(new Error("file"));
      reader.readAsDataURL(file);
    });
    const comma = dataUrl.indexOf(",");
    if (comma >= 0) {
      results.push(dataUrl.slice(comma + 1));
    }
  }
  return results;
}

async function finishPair(
  action: () => Promise<PairResult>,
  refresh: () => Promise<void>,
): Promise<boolean> {
  let result: PairResult;
  try {
    result = await action();
  } catch (error) {
    note(errorText(error));
    await refresh();
    return false;
  }
  const known = await api.listKnownPcs();
  const pc = known[0];
  if (result.status === "trusted") {
    note(en.pairedWith(pc?.name ?? en.knownComputers));
    await refresh();
    return true;
  }
  if (result.status === "needs_forget") {
    note(en.needsForgetOnComputer);
    await refresh();
    return false;
  }
  if (result.status === "rejected") {
    note(en.rejected);
    await refresh();
    return false;
  }
  note(en.waiting);
  await refresh();
  if (!pc) {
    note(en.pairFailed);
    await refresh();
    return false;
  }
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await wait(1000);
    try {
      const next = await api.pollPair(pc.pcId);
      if (next.status === "trusted") {
        note(en.pairedWith(pc.name));
        await refresh();
        return true;
      }
      if (next.status === "rejected") {
        note(en.rejected);
        await refresh();
        return false;
      }
    } catch (error) {
      note(errorText(error));
      await refresh();
      return false;
    }
    if (attempt % 5 === 0) {
      note(en.waiting);
      await refresh();
    }
  }
  note(en.timedOut);
  await refresh();
  return false;
}

function PhoneDevicesScreen({
  initialKnown,
  onPaired,
  onPickImages,
}: {
  initialKnown: Destination[];
  onPaired?: () => void;
  onPickImages?: (imagesBase64: string[]) => void;
}): React.JSX.Element {
  const [known, setKnown] = React.useState<Destination[]>(initialKnown);
  const [nearbyList, setNearbyList] = React.useState<NearbyPc[]>([]);
  const [scanning, setScanning] = React.useState<boolean>(false);
  const [codeValue, setCodeValue] = React.useState<string>("");
  const [addressValue, setAddressValue] = React.useState<string>("");
  const [noticeText, setNoticeText] = React.useState<string>(
    latestNote() || (initialKnown.length === 0 ? en.noComputers : ""),
  );
  const [logs, setLogs] = React.useState<string>(logText());
  const cancelScanRef = React.useRef<(() => Promise<void>) | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const syncHome = React.useCallback(async () => {
    setScanning(false);
    document.documentElement.classList.remove("camera-open");
    const nextKnown = await api.listKnownPcs();
    setKnown(nextKnown);
    setNoticeText(latestNote() || (nextKnown.length === 0 ? en.noComputers : ""));
    setLogs(logText());
  }, []);

  const refreshNearby = React.useCallback(async () => {
    try {
      const list = await api.discoverNearbyPcs();
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
      setLogs(logText());
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
        return;
      }
      note(en.scanning);
      setNoticeText(en.scanning);
      setLogs(logText());
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

  async function submitCode(event: React.FormEvent<HTMLFormElement>): Promise<void> {
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
      <section className="panel phone">
        <h1>{en.scanQr}</h1>
        <div className="scan-hole" />
        <p className="notice">{noticeText || en.scanning}</p>
        <Button
          variant="darkSecondary"
          size="lg"
          onClick={() => {
            void cancelScanRef.current?.();
          }}
        >
          {en.cancel}
        </Button>
        <pre className="phone-log">{logs}</pre>
      </section>
    );
  }

  return (
    <section className="panel phone">
      <h1>{en.knownComputers}</h1>
      <p className="notice">{noticeText}</p>

      {known.length > 0 && onPickImages ? (
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
                  onPickImages(encoded);
                }
              });
            }}
          />
          <Button
            variant="primaryBlue"
            size="lg"
            className="w-full"
            onClick={() => fileInputRef.current?.click()}
          >
            {en.pickImages}
          </Button>
        </>
      ) : null}

      <Button
        variant="primaryBlue"
        size="lg"
        className="w-full"
        onClick={() => {
          void startScan();
        }}
      >
        {en.scanQr}
      </Button>

      <form onSubmit={(e) => void submitCode(e)} className="form code-form">
        <div className="row">
          <Input
            type="text"
            inputMode="numeric"
            maxLength={6}
            placeholder={en.pairCodePlaceholder}
            value={codeValue}
            onChange={(event) =>
              setCodeValue(event.target.value.replace(/\D+/g, "").slice(0, 6))
            }
            className="min-h-11 rounded-full border-[#2c3444] bg-[#1c2230] px-3.5 text-center font-semibold tracking-[0.14em] text-[#f2f4f8]"
          />
          <Button
            type="submit"
            variant="primaryBlue"
            size="lg"
            className="shrink-0"
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
          className="min-h-11 rounded-full border-[#2c3444] bg-[#1c2230] px-3.5 text-[#f2f4f8]"
        />
      </form>

      <div className="list">
        <div className="bar">
          <span className="when">{en.nearbyOnWifi}</span>
          <Button
            variant="darkSecondary"
            size="sm"
            onClick={() => {
              void refreshNearby();
            }}
          >
            {en.refreshNearby}
          </Button>
        </div>
        {nearbyList.map((item) => (
          <Button
            key={item.pcId}
            variant="darkSecondary"
            className="line justify-between rounded-full min-h-12 px-4"
            onClick={() => {
              setAddressValue(`${item.host}:${item.port}`);
            }}
          >
            <span>{`${item.name} (${item.host}:${item.port})`}</span>
          </Button>
        ))}
      </div>

      <div className="list">
        {known.map((pc) => (
          <div key={pc.pcId} className="line">
            <span>{pc.name}</span>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="darkSecondary" size="sm">
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
                        note(en.forgotComputer(pc.name));
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
        ))}
      </div>

      <pre className="phone-log">{logs}</pre>
    </section>
  );
}

export async function mountDevices(
  root: HTMLElement,
  onPaired?: () => void,
  onPickImages?: (imagesBase64: string[]) => void,
): Promise<void> {
  const known = await api.listKnownPcs();
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <PhoneDevicesScreen
      initialKnown={known}
      onPaired={onPaired}
      onPickImages={onPickImages}
    />,
  );
}
