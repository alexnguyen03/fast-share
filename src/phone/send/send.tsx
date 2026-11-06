import { api, type Destination } from "../../shared/commands";
import { en } from "../../shared/locales/en";
import { Button } from "../../shared/ui/button";
import { getOrCreateRoot } from "../../shared/ui/render";
import { mountDevices } from "../devices/devices";
import { mountEditor, type Draft } from "../editor/editor";
import { errorText, note } from "../log";

let inboxBound = false;
let takingInbox = false;

export async function mountPhone(root: HTMLElement): Promise<void> {
  if (!inboxBound) {
    inboxBound = true;
    window.addEventListener("fast-share-inbox", () => {
      void consumeInbox(root, true);
    });
  }
  await consumeInbox(root, false);
}

async function consumeInbox(root: HTMLElement, fromEvent: boolean): Promise<void> {
  if (takingInbox) {
    return;
  }
  takingInbox = true;
  let shared: string[] = [];
  try {
    shared = await api.takeSharedImages();
  } catch (error) {
    note(errorText(error));
  } finally {
    takingInbox = false;
  }
  if (shared.length === 0) {
    if (fromEvent) {
      return;
    }
    await mountDevices(
      root,
      () => {
        void mountPhone(root);
      },
      (pickedBase64) => {
        void openDrafts(root, pickedBase64);
      },
    );
    return;
  }
  await openDrafts(root, shared);
}

export async function openDrafts(
  root: HTMLElement,
  imagesBase64: string[],
): Promise<void> {
  const drafts: Draft[] = imagesBase64.map((pngBase64, index) => ({
    id: `draft-${index}`,
    pngBase64,
    marks: [],
  }));
  await chooseDestination(root, drafts);
}

async function chooseDestination(
  root: HTMLElement,
  drafts: Draft[],
): Promise<void> {
  const known = await api.listKnownPcs();
  if (known.length === 1) {
    openEditor(root, drafts, { ...known[0], online: true }, known);
    void api.discoverDestinations().then((discovered) => {
      const updated = discovered.find((item) => item.pcId === known[0].pcId);
      const dot = root.querySelector<HTMLElement>(".editor .dot");
      if (dot && updated) {
        dot.classList.toggle("on", updated.online);
      }
    });
    return;
  }
  const destinations = await api.discoverDestinations();
  const online = destinations.filter((pc) => pc.online);
  if (online.length === 0) {
    if (known.length > 0) {
      openEditor(root, drafts, known[0], known);
      return;
    }
    showOffline(root, drafts);
    return;
  }
  if (online.length === 1) {
    openEditor(root, drafts, online[0], destinations);
    return;
  }
  showSheet(root, drafts, online, destinations);
}

function showSheet(
  root: HTMLElement,
  drafts: Draft[],
  online: Destination[],
  all: Destination[],
): void {
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <section className="panel phone">
      <header className="bar">
        <h1>{en.sendTo}</h1>
      </header>
      <div className="list">
        {online.map((pc, index) => (
          <Button
            key={pc.pcId}
            variant="darkSecondary"
            className={index === 0 ? "line selected" : "line"}
            onClick={() => openEditor(root, drafts, pc, all)}
          >
            {pc.name}
          </Button>
        ))}
      </div>
    </section>,
  );
}

function showOffline(root: HTMLElement, drafts: Draft[]): void {
  const reactRoot = getOrCreateRoot(root);
  reactRoot.render(
    <section className="panel phone">
      <p className="status show">{en.offline}</p>
      <div className="row">
        <Button
          variant="darkSecondary"
          onClick={() => {
            void chooseDestination(root, drafts);
          }}
        >
          {en.retry}
        </Button>
        <Button
          variant="primaryBlue"
          onClick={() => {
            void mountDevices(root, () => {
              void chooseDestination(root, drafts);
            });
          }}
        >
          {en.scanQr}
        </Button>
      </div>
    </section>,
  );
}

function openEditor(
  root: HTMLElement,
  drafts: Draft[],
  pc: Destination,
  all: Destination[],
): void {
  mountEditor(root, {
    pcName: pc.name,
    online: pc.online,
    drafts,
    onClose: () => {
      void mountDevices(
        root,
        () => {
          void mountPhone(root);
        },
        (pickedBase64) => {
          void openDrafts(root, pickedBase64);
        },
      );
    },
    onSwitch: () =>
      showSheet(
        root,
        drafts,
        all.filter((item) => item.online),
        all,
      ),
    onSend: async (batchId, images) => {
      try {
        await api.sendBatch(pc.pcId, batchId, images);
        note(en.sentTo(pc.name));
        const reactRoot = getOrCreateRoot(root);
        reactRoot.render(
          <section className="panel phone">
            <p className="status show">
              {images.length === 1
                ? `${en.sentTo(pc.name)} ${en.pasteReady}`
                : en.sentTo(pc.name)}
            </p>
            <Button
              variant="primaryBlue"
              size="lg"
              className="w-full"
              onClick={() => {
                void mountPhone(root);
              }}
            >
              {en.back}
            </Button>
          </section>,
        );
      } catch (error) {
        const message = errorText(error);
        note(message || en.didNotReceive(pc.name));
        throw new Error(message || en.didNotReceive(pc.name));
      }
    },
  });
}
