import * as React from "react";
import { api, type WindowPrefs } from "../shared/commands";
import { en } from "../shared/locales/en";
import { cn } from "../shared/lib/utils";
import { Card } from "../shared/ui/card";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../shared/ui/context-menu";
import { showToast, Toaster } from "../shared/ui/toast";

const DRAG_THRESHOLD_PX = 4;

export function DesktopFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  const [prefs, setPrefs] = React.useState<WindowPrefs>({
    snapToEdge: true,
    alwaysOnTop: false,
    dockEdge: null,
    dockExpanded: true,
    dockX: 160,
    dockY: 120,
  });

  const dragStateRef = React.useRef<{
    active: boolean;
    startedDrag: boolean;
    startX: number;
    startY: number;
  }>({
    active: false,
    startedDrag: false,
    startX: 0,
    startY: 0,
  });

  React.useEffect(() => {
    let unlistenDock: (() => void) | null = null;
    let unlistenPair: (() => void) | null = null;
    void api.getWindowPrefs().then(setPrefs);
    void api.onDockState((next) => {
      setPrefs(next);
    }).then((stop) => {
      unlistenDock = stop;
    });
    void api.onDevicePairEvent((name) => {
      showToast(en.deviceRequestToast(name));
    }).then((stop) => {
      unlistenPair = stop;
    });
    return () => {
      unlistenDock?.();
      unlistenPair?.();
    };
  }, []);

  const edge = prefs.dockEdge;
  const isCollapsed = edge !== null && !prefs.dockExpanded;
  const isHorizontal = edge === "top" || edge === "bottom";

  const containerClass = cn(
    "flex h-full w-full",
    edge === "right" && "flex-row-reverse items-start justify-start",
    edge === "top" && "flex-col items-center justify-start",
    edge === "bottom" && "flex-col-reverse items-center justify-start",
    (edge === "left" || edge === null) && "flex-row items-start justify-start",
  );

  const tabShapeClass = isHorizontal
    ? cn(
        "h-[34px] min-w-[138px] px-3.5 py-1",
        edge === "top" ? "rounded-b-[10px]" : "rounded-t-[10px]",
      )
    : cn(
        "min-h-[138px] w-[34px] px-1 py-3.5",
        !isCollapsed && "mt-6",
        edge === "left" && isCollapsed && "rounded-r-[10px]",
        edge === "right" && isCollapsed && "rounded-l-[10px]",
        edge === "right" && !isCollapsed && "rounded-r-[10px]",
        (edge === "left" || edge === null) && !isCollapsed && "rounded-l-[10px]",
      );

  return (
    <div className={containerClass}>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-label={en.appName}
            onPointerDown={(event) => {
              if (event.button !== 0) {
                return;
              }
              dragStateRef.current = {
                active: true,
                startedDrag: false,
                startX: event.clientX,
                startY: event.clientY,
              };
            }}
            onPointerMove={(event) => {
              const state = dragStateRef.current;
              if (!state.active || state.startedDrag) {
                return;
              }
              const dx = event.clientX - state.startX;
              const dy = event.clientY - state.startY;
              if (Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
                state.startedDrag = true;
                state.active = false;
                api.startWindowDrag();
              }
            }}
            onPointerUp={(event) => {
              const state = dragStateRef.current;
              if (!state.active) {
                return;
              }
              state.active = false;
              if (event.button === 0 && !state.startedDrag && prefs.dockEdge !== null) {
                void api.toggleDockExpanded().then(setPrefs);
              }
            }}
            onPointerCancel={() => {
              dragStateRef.current.active = false;
            }}
            className={cn(
              "flex shrink-0 cursor-grab select-none items-center justify-center bg-primary text-primary-foreground active:cursor-grabbing",
              tabShapeClass,
            )}
          >
            <span
              className={cn(
                "pointer-events-none whitespace-nowrap text-[0.98rem] font-bold tracking-[0.04em]",
                !isHorizontal && "[writing-mode:vertical-rl] rotate-180",
              )}
            >
              {en.appName}
            </span>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuCheckboxItem
            checked={prefs.snapToEdge}
            onCheckedChange={(checked) => {
              void api
                .setWindowPrefs({ snapToEdge: Boolean(checked) })
                .then(setPrefs);
            }}
          >
            {en.snapToScreenEdge}
          </ContextMenuCheckboxItem>
          <ContextMenuCheckboxItem
            checked={prefs.alwaysOnTop}
            onCheckedChange={(checked) => {
              void api
                .setWindowPrefs({ alwaysOnTop: Boolean(checked) })
                .then(setPrefs);
            }}
          >
            {en.alwaysOnTop}
          </ContextMenuCheckboxItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            variant="destructive"
            onSelect={() => {
              void api.quitApp();
            }}
          >
            {en.quit}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {isCollapsed ? null : (
        <Card
          className={cn(
            "relative flex h-full min-w-0 flex-1 flex-col gap-3 overflow-hidden rounded-[18px] border-0 bg-background px-[18px] pt-4 pb-3.5 text-foreground shadow-none",
            className,
          )}
        >
          {children}
          <Toaster />
        </Card>
      )}
    </div>
  );
}
