import { api, type PhoneView } from "../../shared/commands";
import { en } from "../../shared/locales/en";

export async function mountPhones(root: HTMLElement, onBack: () => void): Promise<void> {
  const phones = await api.listPhones();
  const shell = document.createElement("section");
  shell.className = "panel";
  shell.innerHTML = `
    <header class="bar">
      <button type="button" data-action="back">${en.back}</button>
      <h1>${en.phones}</h1>
    </header>
    <div class="list" data-list></div>
  `;
  root.replaceChildren(shell);
  const list = shell.querySelector<HTMLElement>("[data-list]");
  if (!list) {
    return;
  }
  shell.querySelector("[data-action=back]")?.addEventListener("click", onBack);
  render(list, phones, () => {
    void mountPhones(root, onBack);
  });
}

function render(list: HTMLElement, phones: PhoneView[], refresh: () => void): void {
  list.replaceChildren();
  for (const phone of phones) {
    const row = document.createElement("div");
    row.className = "line";
    const name = document.createElement("span");
    name.textContent = `${phone.name} · ${phone.trust}`;
    const forget = document.createElement("button");
    forget.type = "button";
    forget.textContent = en.forget;
    forget.disabled = phone.trust === "forgotten";
    forget.addEventListener("click", () => {
      if (!window.confirm(en.forgetPhone(phone.name))) {
        return;
      }
      void api.forgetPhone(phone.id).then(refresh);
    });
    row.append(name, forget);
    list.append(row);
  }
}
