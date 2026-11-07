import * as React from "react";
import { Check } from "lucide-react";

type ToastEntry = {
  id: number;
  text: string;
};

type Listener = (items: ToastEntry[]) => void;

let nextId = 1;
let entries: ToastEntry[] = [];
const listeners = new Set<Listener>();

function emit(): void {
  const snapshot = [...entries];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function showToast(text: string): void {
  const id = nextId++;
  entries = [...entries.slice(-2), { id, text }];
  emit();
  window.setTimeout(() => {
    entries = entries.filter((item) => item.id !== id);
    emit();
  }, 2400);
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
          className="flex items-center gap-2 rounded-full bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          <Check className="h-3.5 w-3.5 stroke-[2.5]" />
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
