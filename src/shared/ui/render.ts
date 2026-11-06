import { createRoot, type Root } from "react-dom/client";

const roots = new WeakMap<HTMLElement, Root>();

export function getOrCreateRoot(container: HTMLElement): Root {
  const existing = roots.get(container);
  if (existing) {
    return existing;
  }
  const root = createRoot(container);
  roots.set(container, root);
  return root;
}
