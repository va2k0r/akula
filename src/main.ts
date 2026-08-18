import "./styles.css";

interface PrototypeApplication {
  initialize(): Promise<void>;
  dispose(): void;
}

const root = document.querySelector<HTMLElement>("#prototype");
if (root === null) {
  throw new Error("The prototype root element is missing.");
}

const searchParameters = new URLSearchParams(globalThis.location.search);
const soundLibraryMode = searchParameters.has("sound-library");
const sfxAuditionMode = searchParameters.has("sfx-audition");
root.className = "";
let app: PrototypeApplication | undefined;
try {
  if (sfxAuditionMode) {
    const { SfxAuditionView } = await import("./ui/SfxAuditionView");
    app = new SfxAuditionView(root);
  } else if (soundLibraryMode) {
    const { ContactSoundLibraryView } =
      await import("./ui/ContactSoundLibraryView");
    app = new ContactSoundLibraryView(root);
  } else {
    const { PrototypeGame } = await import("./game/PrototypeGame");
    app = new PrototypeGame(root);
  }
  if (import.meta.hot !== undefined) {
    import.meta.hot.dispose(() => app?.dispose());
  }
  await app.initialize();
} catch (error: unknown) {
  console.error("Unable to initialize the AKULA playable prototype.", error);
  const status = root.querySelector<HTMLElement>('[data-testid="warning"]');
  if (status !== null) {
    status.textContent = "ASSET LOAD FAILED · CHECK LOCAL SERVER";
  } else {
    root.textContent = "AKULA INITIALISATION FAILED · CHECK LOCAL SERVER";
  }
}
