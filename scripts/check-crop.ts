// Self-check for src/phone/editor/crop.ts. Run: node scripts/check-crop.ts (Node 23.6+ runs .ts).
import assert from "node:assert/strict";
import { dragCrop, FULL_CROP, isFullCrop } from "../src/phone/editor/crop.ts";

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

// a corner moves two edges, the other two stay
const corner = dragCrop(FULL_CROP, "se", { x: 0.6, y: 0.5 });
assert.ok(near(corner.x, 0) && near(corner.y, 0) && near(corner.w, 0.6) && near(corner.h, 0.5));

// an edge moves one edge only
const top = dragCrop(FULL_CROP, "n", { x: 0.9, y: 0.25 });
assert.ok(near(top.x, 0) && near(top.w, 1) && near(top.y, 0.25) && near(top.h, 0.75));

// dragging past the picture stops at its border
const outside = dragCrop({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 }, "nw", { x: -3, y: -3 });
assert.ok(near(outside.x, 0) && near(outside.y, 0) && near(outside.w, 0.7) && near(outside.h, 0.7));

// edges cannot cross: the frame keeps a minimum size
const crossed = dragCrop(FULL_CROP, "w", { x: 1.5, y: 0.5 });
assert.ok(crossed.w > 0.05 && crossed.x + crossed.w <= 1 + 1e-9);

assert.equal(isFullCrop(FULL_CROP), true);
assert.equal(isFullCrop(corner), false);
console.log("crop: ok");
