import * as React from "react";
import { ArrowUpFromLine, ClipboardPaste } from "lucide-react";
import { en } from "../../shared/locales/en";

const CORNER = 16; // the card's rounded corners
const BEND = 34; // radius of the three arcs that cut the notch; the notch is 3 * BEND square
const GAP = 6; // space between the paste button and the notch edge
const BUTTON = 2 * (BEND - GAP);

/**
 * Outline of a rounded card whose bottom-right corner is bitten out by a smooth S-curve
 * (convex, concave, convex arcs), drawn in pixels so the bite stays round at any card size.
 * The concave arc is centred on (w - BEND, h - BEND), which is where the paste button sits.
 */
export function notchPath(w: number, h: number): string {
  const c = CORNER;
  const a = BEND;
  return [
    `M ${c},0`,
    `H ${w - c}`,
    `A ${c},${c} 0 0 1 ${w},${c}`,
    `V ${h - 3 * a}`,
    `A ${a},${a} 0 0 1 ${w - a},${h - 2 * a}`,
    `A ${a},${a} 0 0 0 ${w - 2 * a},${h - a}`,
    `A ${a},${a} 0 0 1 ${w - 3 * a},${h}`,
    `H ${c}`,
    `A ${c},${c} 0 0 1 0,${h - c}`,
    `V ${c}`,
    `A ${c},${c} 0 0 1 ${c},0`,
    "Z",
  ].join(" ");
}

/** The big "pick images" card, with the clipboard button tucked into its bottom-right notch. */
export function NotchedPicker({
  onPickImages,
  onPasteClipboard,
}: {
  onPickImages: () => void;
  onPasteClipboard: () => void;
}): React.JSX.Element {
  const boxRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState<{ w: number; h: number } | null>(null);

  React.useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative h-[36dvh] min-h-60 w-full">
      <div
        role="button"
        tabIndex={0}
        aria-label={en.pickImages}
        onClick={onPickImages}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onPickImages();
          }
        }}
        // until measured, a plain rounded card; then the notched outline
        style={size ? { clipPath: `path("${notchPath(size.w, size.h)}")` } : undefined}
        className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl bg-accent px-5 pb-8 text-center transition-transform outline-none active:scale-[0.99] focus-visible:bg-secondary"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <ArrowUpFromLine className="h-6 w-6" />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-base font-semibold text-foreground">{en.pickImages}</span>
          <span className="text-xs text-muted-foreground">{en.tapToPickPhotos}</span>
        </div>
      </div>
      <button
        type="button"
        aria-label={en.pasteClipboard}
        title={en.pasteClipboard}
        onClick={onPasteClipboard}
        style={{ width: BUTTON, height: BUTTON, right: GAP, bottom: GAP }}
        className="absolute flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 active:scale-95"
      >
        <ClipboardPaste className="h-6 w-6" />
      </button>
    </div>
  );
}
