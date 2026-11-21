import * as React from "react";
import { createRoot } from "react-dom/client";
import { Laptop } from "lucide-react";
import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { cn } from "../../shared/lib/utils";
import { Button } from "../../shared/ui/button";
import { Checkbox } from "../../shared/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../shared/ui/dialog";

const TARGETS_KEY = "fs.phone.targets";

export function loadTargets(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TARGETS_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function saveTargets(ids: string[]): void {
  try {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(ids));
  } catch {
    // only a convenience: nothing is pre-ticked next time
  }
}

function TargetDialog({
  initialKnown,
  onDone,
}: {
  initialKnown: Destination[];
  onDone: (chosen: Destination[] | null) => void;
}): React.JSX.Element {
  const [known, setKnown] = React.useState<Destination[]>(initialKnown);
  const [ticked, setTicked] = React.useState<string[]>(() => {
    const kept = loadTargets().filter((id) => initialKnown.some((pc) => pc.pcId === id));
    return kept.length > 0 ? kept : [initialKnown[0].pcId];
  });

  // The saved list has no live status; ask the network which computers answer.
  React.useEffect(() => {
    let cancelled = false;
    void api
      .discoverDestinations()
      .then((found) => {
        if (!cancelled && found.length > 0) {
          setKnown(found);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          onDone(null);
        }
      }}
    >
      <DialogContent>
        <div className="pr-8">
          <DialogTitle>{en.sendTo}</DialogTitle>
          <DialogDescription>{en.pickComputersHint}</DialogDescription>
        </div>
        <div className="flex flex-col gap-0.5">
          {known.map((pc) => {
            const checked = ticked.includes(pc.pcId);
            return (
              <label
                key={pc.pcId}
                className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-2 active:bg-secondary"
              >
                <Laptop
                  aria-hidden="true"
                  className={cn(
                    "h-5 w-5 shrink-0",
                    pc.online ? "text-success" : "text-muted-foreground/60",
                  )}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-base font-medium",
                    pc.online ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {pc.name}
                  <span className="sr-only">
                    {` · ${pc.online ? en.onlineStatus : en.offlineStatus}`}
                  </span>
                </span>
                <Checkbox
                  checked={checked}
                  aria-label={pc.name}
                  onCheckedChange={() =>
                    setTicked((current) =>
                      current.includes(pc.pcId)
                        ? current.filter((id) => id !== pc.pcId)
                        : [...current, pc.pcId],
                    )
                  }
                />
              </label>
            );
          })}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="ghost" onClick={() => onDone(null)}>
            {en.cancel}
          </Button>
          <Button
            disabled={ticked.length === 0}
            onClick={() => {
              saveTargets(ticked);
              onDone(known.filter((pc) => ticked.includes(pc.pcId)));
            }}
          >
            {en.sendText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where should this toss go? Resolves with the ticked computers, or null if the user backs out.
 * With a single paired computer there is nothing to choose, so it resolves right away.
 */
export async function pickTargets(): Promise<Destination[] | null> {
  const known = await api.listKnownPcs();
  if (known.length === 0) {
    return null;
  }
  if (known.length === 1) {
    return known;
  }
  return new Promise((resolve) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    let settled = false;
    root.render(
      <TargetDialog
        initialKnown={known}
        onDone={(chosen) => {
          if (settled) {
            return;
          }
          settled = true;
          // unmount after this event finishes; React warns about unmounting mid-render
          window.setTimeout(() => {
            root.unmount();
            host.remove();
          });
          resolve(chosen);
        }}
      />,
    );
  });
}
