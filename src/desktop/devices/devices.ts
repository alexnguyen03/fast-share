import { api, type HistoryBatch, type NearbyPc, type PhoneView } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { createDesktopFrame, relativeTime } from "../history/history";

function isComputerName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("pc") || lower.includes("laptop") || lower.includes("mac") || lower.includes("desktop");
}

function deviceIconSvg(name: string): string {
  if (isComputerName(name)) {
    return `<svg class="dev-icon laptop" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 18h20"/></svg>`;
  }
  return `<svg class="dev-icon phone" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#ff5f8d"/><stop offset="100%" stop-color="#5b6cff"/></linearGradient></defs><rect x="6.5" y="2.5" width="11" height="19" rx="2.2" fill="url(#pg)" stroke="#334"/></svg>`;
}

function latestTimeForDevice(name: string, batches: HistoryBatch[]): string {
  const match = batches.find((b) => b.phoneName === name);
  return match ? relativeTime(match.receivedAt) : en.justNow;
}

export async function mountPhones(root: HTMLElement, onBack: () => void): Promise<void> {
  let showQr = false;

  async function renderScreen(): Promise<void> {
    const [phones, status, batches, nearby] = await Promise.all([
      api.listPhones(),
      api.hostStatus(),
      api.listHistory(),
      api.discoverNearbyPcs().catch(() => [] as NearbyPc[]),
    ]);

    const { outer, card } = createDesktopFrame();

    const header = document.createElement("header");
    header.className = "desk-header devices-header";

    const backBtn = document.createElement("button");
    backBtn.type = "button";
    backBtn.className = "desk-icon-btn";
    backBtn.setAttribute("aria-label", en.back);
    backBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>`;
    backBtn.addEventListener("click", onBack);

    const title = document.createElement("h1");
    title.className = "desk-title";
    title.textContent = en.devicesTitle;

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "desk-icon-btn";
    refreshBtn.setAttribute("aria-label", en.refreshNearby);
    refreshBtn.title = en.refreshNearby;
    refreshBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.5-4.6M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.5 4.6M20 20v-5h-5"/></svg>`;
    refreshBtn.addEventListener("click", () => {
      void renderScreen();
    });

    header.append(backBtn, title, refreshBtn);
    card.append(header);

    const content = document.createElement("div");
    content.className = "desk-devices-body";

    // Connected section
    const connectedLabel = document.createElement("h2");
    connectedLabel.className = "desk-section-label";
    connectedLabel.textContent = en.connected;
    content.append(connectedLabel);

    const connectedBox = document.createElement("div");
    connectedBox.className = "desk-group connected";
    const trustedPhones = phones.filter((p) => p.trust === "trusted");

    if (trustedPhones.length === 0) {
      const empty = document.createElement("p");
      empty.className = "desk-group-empty";
      empty.textContent = en.noConnectedDevices;
      connectedBox.append(empty);
    } else {
      for (const phone of trustedPhones) {
        connectedBox.append(
          connectedRow(phone, latestTimeForDevice(phone.name, batches), () => {
            void renderScreen();
          }),
        );
      }
    }
    content.append(connectedBox);

    // In This LAN section
    const lanLabel = document.createElement("h2");
    lanLabel.className = "desk-section-label";
    lanLabel.textContent = en.inThisLan;
    content.append(lanLabel);

    const lanBox = document.createElement("div");
    lanBox.className = "desk-group lan";
    const pendingPhones = phones.filter((p) => p.trust === "pending");
    const lanOthers = nearby.filter((item) => item.name !== status.pcName);

    if (pendingPhones.length === 0 && lanOthers.length === 0) {
      const empty = document.createElement("p");
      empty.className = "desk-group-empty";
      empty.textContent = en.noLanDevices;
      lanBox.append(empty);
    } else {
      for (const pending of pendingPhones) {
        lanBox.append(
          pendingLanRow(pending, () => {
            void renderScreen();
          }),
        );
      }
      for (const item of lanOthers) {
        const row = document.createElement("div");
        row.className = "desk-device-row";
        const iconWrap = document.createElement("span");
        iconWrap.className = "desk-device-icon";
        iconWrap.innerHTML = deviceIconSvg(item.name);
        const nameSpan = document.createElement("span");
        nameSpan.className = "desk-device-name";
        nameSpan.textContent = item.name;
        const hostSpan = document.createElement("span");
        hostSpan.className = "desk-device-time";
        hostSpan.textContent = `${item.host}:${item.port}`;
        row.append(iconWrap, nameSpan, hostSpan);
        lanBox.append(row);
      }
    }
    content.append(lanBox);

    // Pair new phone (QR + 6-digit code)
    const qrToggle = document.createElement("button");
    qrToggle.type = "button";
    qrToggle.className = "desk-qr-toggle";
    qrToggle.textContent = showQr ? en.hideQrPair : `${en.showQrPair} · ${status.pairCode}`;
    qrToggle.addEventListener("click", () => {
      showQr = !showQr;
      void renderScreen();
    });
    content.append(qrToggle);

    if (showQr) {
      const qrBox = document.createElement("div");
      qrBox.className = "desk-qr-box";
      const image = document.createElement("img");
      image.alt = en.pairPhone;
      image.src = `data:image/png;base64,${status.qrPngBase64}`;
      const caption = document.createElement("p");
      caption.textContent = status.pcName;
      const codeLine = document.createElement("p");
      codeLine.className = "pair-code";
      codeLine.textContent = `${en.pairCodeLabel}: ${status.pairCode}`;
      const addrLine = document.createElement("p");
      addrLine.className = "desk-device-time";
      addrLine.textContent = status.lanAddress;
      qrBox.append(image, caption, codeLine, addrLine);

      if (status.firewallWarning) {
        const warnBox = document.createElement("div");
        warnBox.className = "desk-pending-dialog";
        const warnText = document.createElement("p");
        warnText.textContent = en.firewallPublicWarning;
        const allowBtn = document.createElement("button");
        allowBtn.type = "button";
        allowBtn.className = "primary";
        allowBtn.textContent = en.allowFirewallButton;
        allowBtn.addEventListener("click", () => {
          void api.allowFirewall().then(() => {
            void renderScreen();
          });
        });
        warnBox.append(warnText, allowBtn);
        qrBox.append(warnBox);
      }
      content.append(qrBox);
    }

    card.append(content);
    root.replaceChildren(outer);
  }

  await renderScreen();
}

function connectedRow(phone: PhoneView, whenText: string, refresh: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "desk-device-row";

  const iconWrap = document.createElement("span");
  iconWrap.className = "desk-device-icon";
  iconWrap.innerHTML = deviceIconSvg(phone.name);

  const name = document.createElement("span");
  name.className = "desk-device-name";
  name.textContent = phone.name;

  const when = document.createElement("span");
  when.className = "desk-device-time";
  when.textContent = whenText;

  const forget = document.createElement("button");
  forget.type = "button";
  forget.className = "desk-forget-btn";
  forget.textContent = en.forget;
  forget.addEventListener("click", () => {
    if (!window.confirm(en.forgetPhone(phone.name))) {
      return;
    }
    void api.forgetPhone(phone.id).then(refresh);
  });

  row.append(iconWrap, name, when, forget);
  return row;
}

function pendingLanRow(phone: PhoneView, refresh: () => void): HTMLElement {
  const row = document.createElement("div");
  row.className = "desk-device-row";

  const iconWrap = document.createElement("span");
  iconWrap.className = "desk-device-icon";
  iconWrap.innerHTML = deviceIconSvg(phone.name);

  const name = document.createElement("span");
  name.className = "desk-device-name";
  name.textContent = phone.name;

  const actions = document.createElement("div");
  actions.className = "row";

  const accept = document.createElement("button");
  accept.type = "button";
  accept.className = "primary desk-mini-btn";
  accept.textContent = en.accept;
  accept.addEventListener("click", () => {
    void api.acceptPhone(phone.id).then(refresh);
  });

  const reject = document.createElement("button");
  reject.type = "button";
  reject.className = "desk-mini-btn";
  reject.textContent = en.reject;
  reject.addEventListener("click", () => {
    void api.rejectPhone(phone.id).then(refresh);
  });

  actions.append(accept, reject);
  row.append(iconWrap, name, actions);
  return row;
}
