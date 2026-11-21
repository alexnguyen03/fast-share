import { api } from "./shared/commands";
import { mountDesktop } from "./desktop/history/history";
import { mountPreview, type PreviewRequest } from "./desktop/preview/preview";
import { mountPhone } from "./phone/send/send";
import "./styles.css";

const root = document.querySelector<HTMLElement>("#app");

async function boot(): Promise<void> {
  if (!root) {
    return;
  }
  const surface = await api.surface();
  document.documentElement.classList.add(surface);
  if (surface === "phone") {
    await mountPhone(root);
    return;
  }
  // Set by the Rust side when it opens the full-screen preview window.
  const previewRequest = (window as { __FS_PREVIEW__?: PreviewRequest }).__FS_PREVIEW__;
  if (previewRequest) {
    document.documentElement.classList.add("preview");
    await mountPreview(root, previewRequest);
    return;
  }
  await mountDesktop(root);
}

void boot();
