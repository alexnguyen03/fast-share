import * as React from "react";
import { ChevronLeft, Moon, Sun } from "lucide-react";
import { api } from "../../shared/commands";
import { buildLabel } from "../../shared/build-info";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
import {
  applyTheme,
  THEME_PRESETS,
  type AppTheme,
  type Settings,
} from "../../shared/settings";
import { Button } from "../../shared/ui/button";
import { Checkbox } from "../../shared/ui/checkbox";
import { Input } from "../../shared/ui/input";
import { setVibrateEnabled, vibrateEnabled } from "../haptics";
import { Label } from "../../shared/ui/label";
import { getOrCreateRoot } from "../../shared/ui/render";
import { showToast } from "../../shared/ui/toast";
import { PhoneFrame, type PhoneTab } from "../frame";
import { SettingsGroup } from "../settings-group";
import { QuickCaptureCard } from "./quick-capture";

export function PhoneSettingsScreen({
  initialSettings,
  initialPhoneName,
  onSelectTab,
}: {
  initialSettings: Settings;
  initialPhoneName: string;
  onSelectTab: (tab: PhoneTab) => void;
}): React.JSX.Element {
  const [theme, setTheme] = React.useState<AppTheme>(
    initialSettings.theme ?? "emerald-light",
  );
  const [phoneName, setPhoneName] = React.useState(initialPhoneName);
  const [vibrate, setVibrate] = React.useState(vibrateEnabled());
  const debounceRef = React.useRef<number>(0);

  const scheduleNameSave = React.useCallback((nextName: string) => {
    window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      const trimmed = nextName.trim();
      if (!trimmed) {
        return;
      }
      void api
        .setPhoneName(trimmed)
        .then(() => {
          showToast(en.settingsSaved);
        })
        .catch((error: unknown) => {
          showToast(
            error instanceof Error ? error.message : en.settings,
            "destructive",
          );
        });
    }, 450);
  }, []);

  React.useEffect(() => {
    return () => window.clearTimeout(debounceRef.current);
  }, []);

  function selectTheme(nextTheme: AppTheme): void {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    void api.updateSettings({ theme: nextTheme }).then(() => {
      showToast(en.settingsSaved);
    });
  }

  const currentPreset =
    THEME_PRESETS.find((item) => item.id === theme) ?? THEME_PRESETS[0];
  const isDark = currentPreset.mode === "dark";
  const lightPresets = THEME_PRESETS.filter((item) => item.mode === "light");
  const darkPresets = THEME_PRESETS.filter((item) => item.mode === "dark");

  return (
    <PhoneFrame activeTab="settings" onSelectTab={onSelectTab}
      header={
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
      }
    >
      {/* px-1 with -mx-1: room for the field outlines, which the scroll edge would clip */}
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 pt-1 pb-1">
        <SettingsGroup label={<Label htmlFor="phoneName">{en.phoneName}</Label>}>
          <Input
            id="phoneName"
            name="phoneName"
            maxLength={64}
            required
            value={phoneName}
            onChange={(event) => {
              const next = event.target.value;
              setPhoneName(next);
              scheduleNameSave(next);
            }}
          />
        </SettingsGroup>

        <SettingsGroup label={en.appearance}>

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
                      ? "bg-accent font-semibold text-accent-foreground"
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
                  <span className="truncate">{en.themeNames[preset.id]}</span>
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
                      ? "bg-accent font-semibold text-accent-foreground"
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
                  <span className="truncate">{en.themeNames[preset.id]}</span>
                </Button>
              ))}
            </div>
          </div>
        </SettingsGroup>

        <SettingsGroup label={en.general}>
          <div className="flex items-center justify-between">
          <Label htmlFor="vibrate">{en.vibrateAfterSend}</Label>
          <Checkbox
            id="vibrate"
            checked={vibrate}
            onCheckedChange={(next) => {
              setVibrate(next === true);
              setVibrateEnabled(next === true);
            }}
          />
          </div>
        </SettingsGroup>

        <QuickCaptureCard />

        <SettingsGroup label={en.appInfo} className="mt-auto">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appVersionLabel}</span>
            <span className="font-medium text-foreground">
              {en.appVersionValue}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appBuildLabel}</span>
            <span className="font-medium text-foreground">{buildLabel()}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{en.appAuthorLabel}</span>
            <span className="font-medium text-foreground">
              {en.appAuthorValue}
            </span>
          </div>
        </SettingsGroup>
      </div>
    </PhoneFrame>
  );
}

export async function mountPhoneSettings(
  root: HTMLElement,
  onSelectTab: (tab: PhoneTab) => void,
): Promise<void> {
  const [settings, identity] = await Promise.all([
    api.getSettings(),
    api.phoneIdentity(),
  ]);
  applyTheme(settings.theme);
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <PhoneSettingsScreen
      initialSettings={settings}
      initialPhoneName={identity.name}
      onSelectTab={onSelectTab}
    />,
  );
}
