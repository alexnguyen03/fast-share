// Crop frame maths, in picture units (0..1). Self-check: `node scripts/check-crop.ts`.

export const FULL_CROP = { x: 0, y: 0, w: 1, h: 1 };
export type CropRect = typeof FULL_CROP;
export type CropGrip = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MIN_CROP = 0.06;

export function isFullCrop(rect: CropRect): boolean {
  return rect.x < 0.002 && rect.y < 0.002 && rect.w > 0.996 && rect.h > 0.996;
}

/** Moves the dragged edges of `start` to the pointer `p`, kept on the picture and never too small. */
export function dragCrop(start: CropRect, grip: CropGrip, p: { x: number; y: number }): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const x = Math.min(1, Math.max(0, p.x));
  const y = Math.min(1, Math.max(0, p.y));
  if (grip.includes("w")) left = Math.min(x, right - MIN_CROP);
  if (grip.includes("e")) right = Math.max(x, left + MIN_CROP);
  if (grip.includes("n")) top = Math.min(y, bottom - MIN_CROP);
  if (grip.includes("s")) bottom = Math.max(y, top + MIN_CROP);
  return { x: left, y: top, w: right - left, h: bottom - top };
}
