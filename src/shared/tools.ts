export type EditorTool = "crop" | "arrow" | "text" | "blur";

export type Mark =
  | { tool: "crop"; x: number; y: number; w: number; h: number }
  | { tool: "arrow"; x1: number; y1: number; x2: number; y2: number; color: string }
  | { tool: "text"; x: number; y: number; text: string; color: string }
  | { tool: "blur"; x: number; y: number; w: number; h: number };

export const markColors = ["#e23d3d", "#ffffff", "#111111"] as const;
