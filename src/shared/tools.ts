// Crop is not a tool any more: every image carries a crop frame. It stays a Mark so undo and
// saved drafts keep working.
export type ShapeTool = "line" | "rect" | "ellipse" | "arrow";
export type EditorTool = ShapeTool | "text" | "blur" | "erase";

type Segment = { x1: number; y1: number; x2: number; y2: number; color: string };
type Box = { x: number; y: number; w: number; h: number };

export type Mark =
  | ({ tool: "crop" } & Box)
  | ({ tool: "arrow" } & Segment)
  | ({ tool: "line" } & Segment)
  | ({ tool: "rect"; color: string } & Box)
  | ({ tool: "ellipse"; color: string } & Box)
  | { tool: "text"; x: number; y: number; text: string; color: string; size?: number; rotation?: number }
  | ({ tool: "blur" } & Box);

export const markColors = ["#e23d3d", "#ffffff", "#111111"] as const;
