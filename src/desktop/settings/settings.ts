import { api } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { createDesktopFrame } from "../history/history";

export async function mountSettings(root: HTMLElement, onBack: () => void): Promise<void> {
  const settings = await api.getSettings();
  const { outer, card } = createDesktopFrame();

  card.innerHTML = `
    <header class="desk-header devices-header">
      <button type="button" class="desk-icon-btn" data-action="back" aria-label="${en.back}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>
      </button>
      <h1 class="desk-title">${en.settings}</h1>
      <span style="width:32px"></span>
    </header>
    <form class="desk-settings-form">
      <label>${en.pcName}<input name="pcDisplayName" maxlength="64" required /></label>
      <label>${en.retentionDays}<input name="historyRetentionDays" type="number" min="1" max="90" required /></label>
      <button type="submit" class="primary">${en.save}</button>
      <p class="status" data-status></p>
    </form>
  `;
  root.replaceChildren(outer);

  const form = card.querySelector("form");
  const name = card.querySelector<HTMLInputElement>("[name=pcDisplayName]");
  const days = card.querySelector<HTMLInputElement>("[name=historyRetentionDays]");
  const status = card.querySelector<HTMLElement>("[data-status]");
  if (!form || !name || !days || !status) {
    return;
  }
  name.value = settings.pcDisplayName;
  days.value = String(settings.historyRetentionDays);
  card.querySelector("[data-action=back]")?.addEventListener("click", onBack);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const retention = Number(days.value);
    void api
      .updateSettings({ pcDisplayName: name.value.trim(), historyRetentionDays: retention })
      .then(() => onBack())
      .catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : en.settings;
      });
  });
}
