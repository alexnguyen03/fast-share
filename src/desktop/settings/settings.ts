import { api } from "../../shared/commands";
import { en } from "../../shared/locales/en";

export async function mountSettings(root: HTMLElement, onBack: () => void): Promise<void> {
  const settings = await api.getSettings();
  const shell = document.createElement("section");
  shell.className = "panel";
  shell.innerHTML = `
    <header class="bar">
      <button type="button" data-action="back">${en.back}</button>
      <h1>${en.settings}</h1>
    </header>
    <form class="form">
      <label>${en.pcName}<input name="pcDisplayName" maxlength="64" required /></label>
      <label>${en.retentionDays}<input name="historyRetentionDays" type="number" min="1" max="90" required /></label>
      <button type="submit" class="primary">${en.save}</button>
      <p class="status" data-status></p>
    </form>
  `;
  root.replaceChildren(shell);
  const form = shell.querySelector("form");
  const name = shell.querySelector<HTMLInputElement>("[name=pcDisplayName]");
  const days = shell.querySelector<HTMLInputElement>("[name=historyRetentionDays]");
  const status = shell.querySelector<HTMLElement>("[data-status]");
  if (!form || !name || !days || !status) {
    return;
  }
  name.value = settings.pcDisplayName;
  days.value = String(settings.historyRetentionDays);
  shell.querySelector("[data-action=back]")?.addEventListener("click", onBack);
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
