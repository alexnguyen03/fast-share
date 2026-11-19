import * as React from "react";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
import { Button } from "../../shared/ui/button";
import { Card } from "../../shared/ui/card";
import { Checkbox } from "../../shared/ui/checkbox";
import { Label } from "../../shared/ui/label";

type OverlayState = {
  enabled: boolean;
  side: "left" | "right";
  accessibility: boolean;
  openOnScreenshot: boolean;
  xiaomi: boolean;
};

function readState(): OverlayState | null {
  try {
    const raw = window.__FAST_SHARE_ANDROID__?.getOverlayState?.();
    return raw ? (JSON.parse(raw) as OverlayState) : null;
  } catch {
    return null;
  }
}

/** Android only: the bridge is missing elsewhere, so this renders nothing. */
export function QuickCaptureCard(): React.JSX.Element | null {
  const [state, setState] = React.useState(readState);

  // The accessibility switch lives in system settings: re-read when the user comes back.
  React.useEffect(() => {
    const refresh = () => setState(readState());
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  if (!state) {
    return null;
  }
  const bridge = window.__FAST_SHARE_ANDROID__!;
  const update = (next: Partial<OverlayState>) => {
    const merged = { ...state, ...next };
    bridge.setOverlay(merged.enabled, merged.side);
    setState(merged);
  };

  return (
    <Card className="flex flex-col gap-2.5 border-0 bg-muted p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {en.quickCapture}
      </span>
      <div className="flex items-center justify-between">
        <Label htmlFor="handle">{en.quickCaptureHandle}</Label>
        <Checkbox
          id="handle"
          checked={state.enabled}
          onCheckedChange={(next) => update({ enabled: next === true })}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label htmlFor="openOnScreenshot">{en.openOnScreenshot}</Label>
        <Checkbox
          id="openOnScreenshot"
          checked={state.openOnScreenshot}
          onCheckedChange={(next) => {
            bridge.setOpenOnScreenshot(next === true);
            setState({ ...state, openOnScreenshot: next === true });
          }}
        />
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {(["left", "right"] as const).map((side) => (
          <Button
            key={side}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => update({ side })}
            className={cn(
              "rounded-lg text-xs",
              state.side === side
                ? "bg-accent font-semibold text-accent-foreground"
                : "bg-secondary/60 text-foreground",
            )}
          >
            {side === "left" ? en.handleSideLeft : en.handleSideRight}
          </Button>
        ))}
      </div>
      {!state.accessibility && (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p className="m-0">{en.quickCaptureSetup}</p>
          <p className="m-0">{en.quickCaptureRestricted}</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => bridge.openAppInfo()}
            >
              {en.openAppInfo}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => bridge.openAccessibilitySettings()}
            >
              {en.openAccessibility}
            </Button>
          </div>
        </div>
      )}
      {state.xiaomi && (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
          <p className="m-0">{en.quickCaptureXiaomi}</p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => bridge.openAutostart()}
            >
              {en.openAutostart}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => bridge.openAppInfo()}
            >
              {en.openAppInfo}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
