import * as React from "react";
import { ChevronLeft, Moon, Sun } from "lucide-react";
import { api } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
import {
  applyTheme,
  THEME_PRESETS,
  type AppTheme,
  type Settings,
} from "../../shared/settings";
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
  const [theme, setTheme] = React.useState<AppTheme>(
    initialSettings.theme ?? "emerald-light",
  );
  const [statusText, setStatusText] = React.useState("");
  const debounceRef = React.useRef<number>(0);

  const savePatch = React.useCallback((patch: Partial<Settings>, notify = false) => {
    setStatusText("");
    void api
      .updateSettings(patch)
      .then(() => {
        if (notify) {
          showToast(en.settingsSaved);
        }
      })
      .catch((error: unknown) => {
        setStatusText(error instanceof Error ? error.message : en.settings);
      });
  }, []);

  const scheduleTextSave = React.useCallback(
    (nextName: string, nextDays: string) => {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        const trimmed = nextName.trim();
        const retention = Number(nextDays);
        if (!trimmed || Number.isNaN(retention) || retention < 1 || retention > 90) {
          return;
        }
        savePatch(
          {
            pcDisplayName: trimmed,
            historyRetentionDays: retention,
          },
          true,
        );
      }, 450);
    },
    [savePatch],
  );

  React.useEffect(() => {
    return () => window.clearTimeout(debounceRef.current);
  }, []);

  function selectTheme(nextTheme: AppTheme): void {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    savePatch({ theme: nextTheme });
  }

  const currentPreset =
    THEME_PRESETS.find((item) => item.id === theme) ?? THEME_PRESETS[0];
  const isDark = currentPreset.mode === "dark";
  const lightPresets = THEME_PRESETS.filter((item) => item.mode === "light");
  const darkPresets = THEME_PRESETS.filter((item) => item.mode === "dark");

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
        <Button
          variant="ghost"
          size="icon"
          aria-label={en.appearance}
          title={isDark ? en.lightThemes : en.darkThemes}
          onClick={() => {
            const target = isDark ? lightPresets[0].id : darkPresets[0].id;
            selectTheme(target);
          }}
        >
          {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pt-1 pr-0.5">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pcDisplayName">{en.pcName}</Label>
          <Input
            id="pcDisplayName"
            name="pcDisplayName"
            maxLength={64}
            required
            value={pcName}
            onChange={(event) => {
              const next = event.target.value;
              setPcName(next);
              scheduleTextSave(next, retentionDays);
            }}
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
            onChange={(event) => {
              const next = event.target.value;
              setRetentionDays(next);
              scheduleTextSave(pcName, next);
            }}
          />
        </div>

        <Card className="flex flex-col gap-2.5 bg-muted p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en.appearance}
          </span>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {en.lightThemes}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {lightPresets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectTheme(preset.id)}
                  className={cn(
                    "flex h-auto flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs",
                    theme === preset.id
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "bg-secondary/60 text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.bg }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.primary }}
                    />
                  </span>
                  <span className="truncate">
                    {en.themeNames[preset.id]}
                  </span>
                </Button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">
              {en.darkThemes}
            </span>
            <div className="grid grid-cols-3 gap-1.5">
              {darkPresets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => selectTheme(preset.id)}
                  className={cn(
                    "flex h-auto flex-col items-center gap-1 rounded-lg px-2 py-2 text-xs",
                    theme === preset.id
                      ? "bg-accent text-accent-foreground font-semibold"
                      : "bg-secondary/60 text-foreground",
                  )}
                >
                  <span className="flex items-center gap-1">
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.bg }}
                    />
                    <span
                      className="h-3.5 w-3.5 rounded-full"
                      style={{ background: preset.primary }}
                    />
                  </span>
                  <span className="truncate">
                    {en.themeNames[preset.id]}
                  </span>
                </Button>
              ))}
            </div>
          </div>
        </Card>

        <Card className="flex flex-col gap-3 bg-muted p-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = !autoCopyToClipboard;
              setAutoCopyToClipboard(next);
              savePatch({ autoCopyToClipboard: next }, true);
            }}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.autoCopyToClipboard}
            </span>
            <Checkbox
              checked={autoCopyToClipboard}
              onCheckedChange={(v) => {
                const next = Boolean(v);
                setAutoCopyToClipboard(next);
                savePatch({ autoCopyToClipboard: next }, true);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = !closeToTray;
              setCloseToTray(next);
              savePatch({ closeToTray: next }, true);
            }}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.closeToTray}
            </span>
            <Checkbox
              checked={closeToTray}
              onCheckedChange={(v) => {
                const next = Boolean(v);
                setCloseToTray(next);
                savePatch({ closeToTray: next }, true);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              const next = !autoStartWithOs;
              setAutoStartWithOs(next);
              savePatch({ autoStartWithOs: next }, true);
            }}
            className="flex cursor-pointer items-center justify-between gap-3"
          >
            <span className="text-sm font-medium text-foreground">
              {en.autoStartWithOs}
            </span>
            <Checkbox
              checked={autoStartWithOs}
              onCheckedChange={(v) => {
                const next = Boolean(v);
                setAutoStartWithOs(next);
                savePatch({ autoStartWithOs: next }, true);
              }}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </Card>

        {statusText ? (
          <p className="text-sm text-destructive">{statusText}</p>
        ) : null}

        <Card className="mt-auto flex flex-col gap-1.5 bg-muted p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {en.appInfo}
          </span>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appVersionLabel}</span>
            <span className="font-medium text-foreground">
              {en.appVersionValue}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appAuthorLabel}</span>
            <span className="font-medium text-foreground">
              {en.appAuthorValue}
            </span>
          </div>
        </Card>
      </div>
    </DesktopFrame>
  );
}

export async function mountSettings(
  root: HTMLElement,
  onBack: () => void,
): Promise<void> {
  const settings = await api.getSettings();
  applyTheme(settings.theme);
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <DesktopSettingsScreen initialSettings={settings} onBack={onBack} />,
  );
}
