import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { api } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import type { Settings } from "../../shared/settings";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Checkbox } from "../../shared/ui/checkbox";
import { Input } from "../../shared/ui/input";
import { Label } from "../../shared/ui/label";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { DesktopFrame } from "../frame";

function DesktopSettingsScreen({
  initialSettings,
  onBack,
}: {
  initialSettings: Settings;
  onBack: () => void;
}): React.JSX.Element {
  const [pcName, setPcName] = React.useState(initialSettings.pcDisplayName);
  const [retentionDays, setRetentionDays] = React.useState(
    String(initialSettings.historyRetentionDays),
  );
  const [autoStartWithOs, setAutoStartWithOs] = React.useState<boolean>(
    initialSettings.autoStartWithOs ?? false,
  );
  const [closeToTray, setCloseToTray] = React.useState<boolean>(
    initialSettings.closeToTray ?? true,
  );
  const [autoCopyToClipboard, setAutoCopyToClipboard] = React.useState<boolean>(
    initialSettings.autoCopyToClipboard ?? true,
  );
  const [statusText, setStatusText] = React.useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const retention = Number(retentionDays);
    void api
      .updateSettings({
        pcDisplayName: pcName.trim(),
        historyRetentionDays: retention,
        autoStartWithOs,
        closeToTray,
        autoCopyToClipboard,
      })
      .then(() => {
        showToast(en.settingsSaved);
        onBack();
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : en.settings);
      });
  }

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
          {en.settings}
        </h1>
        <span className="w-9" />
      </header>

      <form
        onSubmit={handleSubmit}
        className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto pt-2"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pcDisplayName">{en.pcName}</Label>
          <Input
            id="pcDisplayName"
            name="pcDisplayName"
            maxLength={64}
            required
            value={pcName}
            onChange={(event) => setPcName(event.target.value)}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="historyRetentionDays">{en.retentionDays}</Label>
          <Input
            id="historyRetentionDays"
            name="historyRetentionDays"
            type="number"
            min={1}
            max={90}
            required
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.target.value)}
          />
        </div>

        <Card className="flex flex-col gap-3 bg-muted p-3.5">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setAutoCopyToClipboard((prev) => !prev)}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.autoCopyToClipboard}
            </span>
            <Checkbox
              checked={autoCopyToClipboard}
              onCheckedChange={(v) => setAutoCopyToClipboard(Boolean(v))}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setCloseToTray((prev) => !prev)}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.closeToTray}
            </span>
            <Checkbox
              checked={closeToTray}
              onCheckedChange={(v) => setCloseToTray(Boolean(v))}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => setAutoStartWithOs((prev) => !prev)}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.autoStartWithOs}
            </span>
            <Checkbox
              checked={autoStartWithOs}
              onCheckedChange={(v) => setAutoStartWithOs(Boolean(v))}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </Card>

        <Button type="submit" variant="default" className="mt-1 w-full">
          {en.save}
        </Button>

        {statusText ? (
          <p className="text-sm text-destructive">{statusText}</p>
        ) : null}
      </form>
    </DesktopFrame>
  );
}

export async function mountSettings(
  root: HTMLElement,
  onBack: () => void,
): Promise<void> {
  const settings = await api.getSettings();
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <DesktopSettingsScreen initialSettings={settings} onBack={onBack} />,
  );
}
