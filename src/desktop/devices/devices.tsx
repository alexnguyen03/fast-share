import * as React from "react";
import { ChevronLeft, Laptop, RefreshCw, Smartphone } from "lucide-react";
import {
  api,
  type HistoryBatch,
  type HostStatus,
  type NearbyPc,
  type PhoneView,
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
import { Card } from "../../shared/ui/card";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { DesktopFrame } from "../frame";
import { relativeTime } from "../history/history";

function isComputerName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("pc") ||
    lower.includes("laptop") ||
    lower.includes("mac") ||
    lower.includes("desktop")
  );
}

function DeviceAvatar({ name }: { name: string }): React.JSX.Element {
  if (isComputerName(name)) {
    return <Laptop className="h-5 w-5 text-foreground" />;
  }
  return <Smartphone className="h-5 w-5 text-primary" />;
}

function latestTimeForDevice(name: string, batches: HistoryBatch[]): string {
  const match = batches.find((b) => b.phoneName === name);
  return match ? relativeTime(match.receivedAt) : en.justNow;
}

function DesktopDevicesScreen({
  initialPhones,
  initialStatus,
  initialBatches,
  initialNearby,
  onBack,
}: {
  initialPhones: PhoneView[];
  initialStatus: HostStatus;
  initialBatches: HistoryBatch[];
  initialNearby: NearbyPc[];
  onBack: () => void;
}): React.JSX.Element {
  const [phones, setPhones] = React.useState<PhoneView[]>(initialPhones);
  const [status, setStatus] = React.useState<HostStatus>(initialStatus);
  const [batches, setBatches] = React.useState<HistoryBatch[]>(initialBatches);
  const [nearby, setNearby] = React.useState<NearbyPc[]>(initialNearby);
  const [showQr, setShowQr] = React.useState<boolean>(false);

  const refresh = React.useCallback(async () => {
    const [nextPhones, nextStatus, nextBatches, nextNearby] = await Promise.all([
      api.listPhones(),
      api.hostStatus(),
      api.listHistory(),
      api.discoverNearbyPcs().catch(() => [] as NearbyPc[]),
    ]);
    setPhones(nextPhones);
    setStatus(nextStatus);
    setBatches(nextBatches);
    setNearby(nextNearby);
  }, []);

  const trustedPhones = phones.filter((p) => p.trust === "trusted");
  const pendingPhones = phones.filter((p) => p.trust === "pending");
  const lanOthers = nearby.filter((item) => item.name !== status.pcName);

  return (
    <DesktopFrame>
      <header className="grid min-h-9 grid-cols-[36px_1fr_36px] items-center gap-2.5">
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.back}
          onClick={onBack}
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
            void refresh();
          }}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pt-1">
        <h2 className="mt-1.5 mb-0.5 text-base font-semibold text-foreground">
          {en.connected}
        </h2>
        <Card className="flex flex-col gap-1 border-transparent bg-accent px-3 py-2 shadow-none">
          {trustedPhones.length === 0 ? (
            <p className="px-1 py-2.5 text-sm text-muted-foreground">
              {en.noConnectedDevices}
            </p>
          ) : (
            trustedPhones.map((phone) => (
              <div
                key={phone.id}
                className="flex min-h-10 items-center gap-2.5 py-1"
              >
                <DeviceAvatar name={phone.name} />
                <span className="min-w-0 flex-1 truncate text-[0.96rem] font-medium text-foreground">
                  {phone.name}
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">
                  {latestTimeForDevice(phone.name, batches)}
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
                        {en.forgetPhone(phone.name)}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>{en.cancel}</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void api.forgetPhone(phone.id).then(() => {
                            showToast(en.forgotComputer(phone.name));
                            return refresh();
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

        <h2 className="mt-1.5 mb-0.5 text-base font-semibold text-foreground">
          {en.inThisLan}
        </h2>
        <Card className="flex flex-col gap-1 border-transparent bg-muted px-3 py-2 shadow-none">
          {pendingPhones.length === 0 && lanOthers.length === 0 ? (
            <p className="px-1 py-2.5 text-sm text-muted-foreground">
              {en.noLanDevices}
            </p>
          ) : (
            <>
              {pendingPhones.map((pending) => (
                <div
                  key={pending.id}
                  className="flex min-h-10 items-center gap-2.5 py-1"
                >
                  <DeviceAvatar name={pending.name} />
                  <span className="min-w-0 flex-1 truncate text-[0.96rem] font-medium text-foreground">
                    {pending.name}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      variant="default"
                      size="xs"
                      onClick={() => {
                        void api.acceptPhone(pending.id).then(() => {
                          showToast(en.deviceConnectedToast(pending.name));
                          return refresh();
                        });
                      }}
                    >
                      {en.accept}
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      onClick={() => {
                        void api.rejectPhone(pending.id).then(refresh);
                      }}
                    >
                      {en.reject}
                    </Button>
                  </div>
                </div>
              ))}
              {lanOthers.map((item) => (
                <div
                  key={item.pcId}
                  className="flex min-h-10 items-center gap-2.5 py-1"
                >
                  <DeviceAvatar name={item.name} />
                  <span className="min-w-0 flex-1 truncate text-[0.96rem] font-medium text-foreground">
                    {item.name}
                  </span>
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {`${item.host}:${item.port}`}
                  </span>
                </div>
              ))}
            </>
          )}
        </Card>

        <Button
          variant="secondary"
          className="mt-1 w-full font-semibold"
          onClick={() => setShowQr((prev) => !prev)}
        >
          {showQr ? en.hideQrPair : `${en.showQrPair} · ${status.pairCode}`}
        </Button>

        {showQr ? (
          <Card className="flex flex-col items-center gap-1 border-0 bg-muted p-3">
            <img
              src={`data:image/png;base64,${status.qrPngBase64}`}
              alt={en.pairPhone}
              className="h-39 w-39 rounded-lg"
            />
            <p className="text-sm font-medium">{status.pcName}</p>
            <p className="mt-1 text-center text-xl font-bold tracking-[0.12em]">
              {`${en.pairCodeLabel}: ${status.pairCode}`}
            </p>
            <p className="text-sm text-muted-foreground">{status.lanAddress}</p>
            {status.firewallWarning ? (
              <Card className="mt-2 flex flex-col gap-2 border-0 bg-accent p-2.5">
                <p className="text-xs">{en.firewallPublicWarning}</p>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    void api.allowFirewall().then(refresh);
                  }}
                >
                  {en.allowFirewallButton}
                </Button>
              </Card>
            ) : null}
          </Card>
        ) : null}
      </div>
    </DesktopFrame>
  );
}

export async function mountPhones(
  root: HTMLElement,
  onBack: () => void,
): Promise<void> {
  const [phones, status, batches, nearby] = await Promise.all([
    api.listPhones(),
    api.hostStatus(),
    api.listHistory(),
    api.discoverNearbyPcs().catch(() => [] as NearbyPc[]),
  ]);
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <DesktopDevicesScreen
      initialPhones={phones}
      initialStatus={status}
      initialBatches={batches}
      initialNearby={nearby}
      onBack={onBack}
    />,
  );
}
