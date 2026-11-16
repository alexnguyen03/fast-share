import * as React from "react";
import { Check, X } from "lucide-react";

type ToastVariant = "default" | "destructive";

export type ToastAction = {
  label: string;
  onAction: () => void;
};

type ToastEntry = {
  id: number;
  text: string;
  variant: ToastVariant;
  action: ToastAction | null;
};

type Listener = (items: ToastEntry[]) => void;

const ACTION_DURATION_MS = 5000;
const DEFAULT_DURATION_MS = 2400;

let nextId = 1;
let entries: ToastEntry[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = [...entries];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

function dismiss(id: number): void {
  entries = entries.filter((item) => item.id !== id);
  emit();
}

export function showToast(
  text: string,
  variant: ToastVariant = "default",
  action?: ToastAction,
): number {
  const id = nextId++;
  entries = [
    ...entries.slice(-2),
    { id, text, variant, action: action ?? null },
  ];
  emit();
  window.setTimeout(
    () => dismiss(id),
    action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS,
  );
  return id;
}

export function dismissToast(id: number): void {
  dismiss(id);
}

export function Toaster(): React.JSX.Element | null {
  const [items, setItems] = React.useState<ToastEntry[]>(entries);

  React.useEffect(() => {
    listeners.add(setItems);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed right-4 bottom-14 left-4 z-50 flex flex-col items-center gap-1.5">
      {items.map((item) => (
        <div
          key={item.id}
          role={item.variant === "destructive" ? "alert" : "status"}
          aria-live={item.variant === "destructive" ? "assertive" : "polite"}
          className={
            item.variant === "destructive"
              ? "pointer-events-auto flex items-center gap-2 rounded-full bg-destructive px-3.5 py-1.5 text-xs font-semibold text-destructive-foreground"
              : "pointer-events-auto flex items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
          }
        >
          {item.variant === "destructive" ? (
            <X className="h-3.5 w-3.5 shrink-0 stroke-[2.5]" />
          ) : (
            <Check className="h-3.5 w-3.5 shrink-0 stroke-[2.5]" />
          )}
          <span>{item.text}</span>
          {item.action ? (
            <button
              type="button"
              onClick={() => {
                const action = item.action;
                dismiss(item.id);
                action?.onAction();
              }}
              className="ml-1 rounded-full bg-primary-foreground/20 px-2 py-0.5 text-xs font-bold tracking-wide uppercase transition-colors hover:bg-primary-foreground/30 focus-visible:ring-2 focus-visible:ring-primary-foreground/60 focus-visible:outline-none"
            >
              {item.action.label}
            </button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
