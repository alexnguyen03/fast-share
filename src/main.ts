import { api } from "./shared/commands";
import { mountDesktop } from "./desktop/history/history";
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
  await mountDesktop(root);
}

void boot();
