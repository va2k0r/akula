import {
  AcousticSignatureEngine,
  contactSoundProfileById,
  type AcousticCode,
} from "../audio";
import {
  AudioSessionCoordinator,
  type AudioSessionOutput,
} from "../game/AudioSessionCoordinator";
import { FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS } from "../game/ContactSignature";
import {
  VESSEL_CLASS_CATALOG,
  type VesselClassDefinition,
} from "../game/NavalContactCatalog";
import { ContactProfileAnalysisVisual } from "./ContactProfileAnalysisVisual";
import type { ContactAnalysisMode } from "../visualization/contactProfileAnalysis";

type PlaybackMode = ContactAnalysisMode;

export class ContactSoundLibraryView {
  private readonly abortController = new AbortController();
  private readonly output = new SoundLibraryOutput();
  private readonly audioSession = new AudioSessionCoordinator(this.output);
  private readonly status: HTMLOutputElement;
  private readonly analysisVisualByProfileId: Map<
    string,
    ContactProfileAnalysisVisual
  >;
  private activeEngine: AcousticSignatureEngine | undefined;
  private activeButton: HTMLButtonElement | undefined;
  private activeAnalysisVisual: ContactProfileAnalysisVisual | undefined;
  private requestId = 0;
  private disposed = false;

  public constructor(private readonly root: HTMLElement) {
    root.replaceChildren();
    root.className = "sound-library";
    root.innerHTML = createSoundLibraryMarkup();
    this.status = requireElement<HTMLOutputElement>(
      root,
      '[data-testid="sound-library-status"]',
    );
    this.analysisVisualByProfileId = new Map(
      VESSEL_CLASS_CATALOG.map((vesselClass) => {
        const soundProfile = contactSoundProfileById(
          vesselClass.audioProfileId,
        );
        const analysisRoot = requireElement<HTMLElement>(
          root,
          `[data-sound-analysis="${soundProfile.id}"]`,
        );
        return [
          soundProfile.id,
          new ContactProfileAnalysisVisual(
            analysisRoot,
            this.output.context,
            soundProfile,
            vesselClass.signatureCode,
            FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
          ),
        ] as const;
      }),
    );
    document.title = "AKULA · Countable contact sound repository";
    root.addEventListener("click", this.handleClick, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener("pagehide", () => this.dispose(), {
      once: true,
      signal: this.abortController.signal,
    });
  }

  public async initialize(): Promise<void> {
    this.status.value = "PREPARING MODULATION AND RECORDED-VOLUME ANALYSIS";
    const results = await Promise.allSettled(
      [...this.analysisVisualByProfileId.values()].map((visual) =>
        visual.prepare(),
      ),
    );
    if (this.disposed) {
      return;
    }
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failure !== undefined) {
      this.status.value =
        "VISUAL ANALYSIS PARTIAL · AUDIO CONTROLS REMAIN AVAILABLE";
      console.error(
        "Unable to prepare one or more contact analysis views.",
        failure.reason,
      );
      return;
    }
    this.status.value = "READY · PLAY ALL OR ISOLATE ONE CHANNEL";
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.requestId += 1;
    this.abortController.abort();
    this.activeEngine?.dispose();
    this.activeEngine = undefined;
    for (const visual of this.analysisVisualByProfileId.values()) {
      visual.dispose();
    }
    this.analysisVisualByProfileId.clear();
    this.activeAnalysisVisual = undefined;
    this.audioSession.dispose();
    this.output.dispose();
  }

  private readonly handleClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest<HTMLButtonElement>("button[data-action]");
    if (button === null) {
      return;
    }
    const action = button.dataset["action"];
    if (action === "stop") {
      this.stop();
      return;
    }
    const profileId = button.dataset["profileId"];
    if (
      profileId === undefined ||
      !["mix", "a", "b", "c"].includes(action ?? "")
    ) {
      return;
    }
    void this.play(profileId, action as PlaybackMode, button);
  };

  private async play(
    profileId: string,
    mode: PlaybackMode,
    button: HTMLButtonElement,
  ): Promise<void> {
    const requestId = ++this.requestId;
    this.activeEngine?.dispose();
    this.activeEngine = undefined;
    this.stopActiveAnalysis();
    this.setActiveButton(undefined);
    const vesselClass = vesselClassByAudioProfileId(profileId);
    const soundProfile = contactSoundProfileById(profileId);
    const signature = isolatedSignature(vesselClass.signatureCode, mode);
    this.status.value = `LOADING · ${soundProfile.displayName.toUpperCase()}`;

    try {
      await this.audioSession.resumeFromUserGesture();
      if (this.disposed || requestId !== this.requestId) {
        return;
      }
      const engine = new AcousticSignatureEngine({
        audioContext: this.output.context,
        output: this.output.input,
        signature,
        cycleDuration: FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
        soundProfileId: profileId,
        continuousProfileMix: mode === "mix",
      });
      this.activeEngine = engine;
      await engine.play();
      if (this.disposed || requestId !== this.requestId) {
        engine.dispose();
        return;
      }
      this.setActiveButton(button);
      const analysisVisual = this.analysisVisualByProfileId.get(profileId);
      analysisVisual?.play(mode, () => engine.getPlaybackElapsedTime());
      this.activeAnalysisVisual = analysisVisual;
      this.status.value = `${disposition(vesselClass)} · ${vesselClass.displayName.toUpperCase()} · ${modeLabel(mode)} LOOPING`;
    } catch (error) {
      if (requestId !== this.requestId) {
        return;
      }
      this.activeEngine?.dispose();
      this.activeEngine = undefined;
      this.stopActiveAnalysis();
      this.status.value = "LOAD FAILED · CHECK THE LOCAL AUDIO BANK";
      console.error("Unable to play the AKULA contact sound bank.", error);
    }
  }

  private stop(): void {
    this.requestId += 1;
    this.activeEngine?.dispose();
    this.activeEngine = undefined;
    this.stopActiveAnalysis();
    this.setActiveButton(undefined);
    this.status.value = "STOPPED · TRUE DIGITAL SILENCE";
  }

  private setActiveButton(button: HTMLButtonElement | undefined): void {
    this.activeButton?.setAttribute("aria-pressed", "false");
    this.activeButton = button;
    this.activeButton?.setAttribute("aria-pressed", "true");
  }

  private stopActiveAnalysis(): void {
    this.activeAnalysisVisual?.stop();
    this.activeAnalysisVisual = undefined;
  }
}

class SoundLibraryOutput implements AudioSessionOutput {
  public readonly context = new AudioContext({ latencyHint: "interactive" });
  public readonly input = this.context.createGain();
  private readonly master = this.context.createGain();
  private disposed = false;

  public constructor() {
    const hydrophoneFilter = this.context.createBiquadFilter();
    hydrophoneFilter.type = "lowpass";
    hydrophoneFilter.frequency.value = 1_650;
    hydrophoneFilter.Q.value = 0.68;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 12;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.12;
    this.input.gain.value = 0.9;
    this.master.gain.value = 0;
    this.input
      .connect(hydrophoneFilter)
      .connect(compressor)
      .connect(this.master)
      .connect(this.context.destination);
  }

  public setSessionActive(active: boolean): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    if (!active) {
      this.master.gain.setValueAtTime(0, now);
      return;
    }
    this.master.gain.setValueAtTime(0, now);
    this.master.gain.linearRampToValueAtTime(0.82, now + 0.025);
  }

  public async resume(): Promise<void> {
    if (!this.disposed && this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.input.disconnect();
    this.master.disconnect();
    void this.context.close();
  }
}

function createSoundLibraryMarkup(): string {
  const neutralClasses = VESSEL_CLASS_CATALOG.filter(
    (definition) => disposition(definition) === "NEUTRAL",
  );
  const hostileClasses = VESSEL_CLASS_CATALOG.filter(
    (definition) => disposition(definition) === "HOSTILE",
  );
  return `
    <div class="sound-library-shell">
      <header class="sound-library-head">
        <div>
          <span class="sound-library-kicker">AKULA / ACOUSTIC MATERIALS LAB / REAL RECORDINGS</span>
          <h1>COUNTABLE CONTACT SOUND REPOSITORY</h1>
          <p>Authentic cavitation, engine-room, pump and valve recordings cut into countable events. Count the time-binned RMS peaks first; use the modulation overlay as a frequency reference.</p>
        </div>
        <button type="button" class="sound-stop" data-action="stop">STOP ALL</button>
      </header>
      ${profileGroup("NEUTRAL SOURCES", neutralClasses)}
      ${profileGroup("HOSTILE SOURCES", hostileClasses)}
      <footer class="sound-library-footer">
        <output data-testid="sound-library-status" aria-live="polite">INITIALISING</output>
        <span>real recordings · time-binned volume RMS · modulation reference</span>
      </footer>
    </div>
  `;
}

function profileGroup(
  heading: string,
  vesselClasses: readonly VesselClassDefinition[],
): string {
  return `
    <section class="sound-profile-group" aria-labelledby="${slug(heading)}">
      <div class="sound-group-heading">
        <h2 id="${slug(heading)}">${heading}</h2>
        <span>${String(vesselClasses.length).padStart(2, "0")} PROFILES</span>
      </div>
      <div class="sound-profile-grid">
        ${vesselClasses.map(profileCard).join("")}
      </div>
    </section>
  `;
}

function profileCard(vesselClass: VesselClassDefinition): string {
  const soundProfile = contactSoundProfileById(vesselClass.audioProfileId);
  const [a, b, c] = soundProfile.components;
  const code = vesselClass.signatureCode;
  return `
    <article class="sound-profile-card" data-profile="${soundProfile.id}">
      <div class="sound-profile-title">
        <div>
          <span>${vesselClass.faction}</span>
          <h3>${vesselClass.displayName}</h3>
        </div>
        <strong aria-label="Acoustic code ${code.join(" ")}">${code.join(" · ")}</strong>
      </div>
      <p>${soundProfile.description}</p>
      <ol class="sound-component-list">
        <li><b>A × ${String(code[0])}</b><span>${a.label}</span></li>
        <li><b>B × ${String(code[1])}</b><span>${b.label}</span></li>
        <li><b>C × ${String(code[2])}</b><span>${c.label}</span></li>
      </ol>
      ${analysisMarkup(soundProfile, code)}
      <div class="sound-profile-actions">
        ${playButton(soundProfile.id, "mix", "PLAY ALL")}
        ${playButton(soundProfile.id, "a", "A ONLY")}
        ${playButton(soundProfile.id, "b", "B ONLY")}
        ${playButton(soundProfile.id, "c", "C ONLY")}
      </div>
    </article>
  `;
}

function analysisMarkup(
  soundProfile: ReturnType<typeof contactSoundProfileById>,
  code: AcousticCode,
): string {
  return `
    <div class="sound-analysis" data-sound-analysis="${soundProfile.id}" data-mode="mix">
      <section class="sound-analysis-panel" aria-label="Recorded volume analysis">
        <div class="sound-analysis-heading">
          <span>BEAT VOLUME · PRIMARY</span>
          <output data-analysis-mode>MIX · RMS / ${FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS.toFixed(1)} S</output>
        </div>
        <canvas
          class="sound-analysis-canvas volume-histogram-canvas"
          data-analysis-canvas="volume"
          role="img"
          aria-label="Time-binned relative RMS volume over one acoustic cycle"
        >Relative RMS volume bars over one acoustic cycle.</canvas>
      </section>
      <section class="sound-analysis-panel modulation-reference-panel" aria-label="Modulation analysis">
        <div class="sound-analysis-heading">
          <span>MODULATION · REFERENCE</span>
          <span class="sound-analysis-legend" aria-label="Channels A B and C">
            <i data-channel="a">A</i><i data-channel="b">B</i><i data-channel="c">C</i>
          </span>
        </div>
        <canvas
          class="sound-analysis-canvas modulation-trace-canvas"
          data-analysis-canvas="modulation"
          role="img"
          aria-label="Overlaid modulation traces for acoustic code ${code.join(" ")}"
        >Three overlaid modulation traces for channels A, B and C.</canvas>
      </section>
    </div>
  `;
}

function playButton(
  profileId: string,
  mode: PlaybackMode,
  label: string,
): string {
  return `<button type="button" data-action="${mode}" data-profile-id="${profileId}" aria-pressed="false">${label}</button>`;
}

function isolatedSignature(
  signature: AcousticCode,
  mode: PlaybackMode,
): AcousticCode {
  if (mode === "mix") {
    return signature;
  }
  const componentIndex = ({ a: 0, b: 1, c: 2 } as const)[mode];
  return [
    componentIndex === 0 ? signature[0] : 0,
    componentIndex === 1 ? signature[1] : 0,
    componentIndex === 2 ? signature[2] : 0,
  ];
}

function vesselClassByAudioProfileId(profileId: string): VesselClassDefinition {
  const vesselClass = VESSEL_CLASS_CATALOG.find(
    (definition) => definition.audioProfileId === profileId,
  );
  if (vesselClass === undefined) {
    throw new Error(`No vessel class uses contact sound profile: ${profileId}`);
  }
  return vesselClass;
}

function disposition(
  vesselClass: VesselClassDefinition,
): "NEUTRAL" | "HOSTILE" {
  return vesselClass.faction === "NATO" ? "HOSTILE" : "NEUTRAL";
}

function modeLabel(mode: PlaybackMode): string {
  return mode === "mix"
    ? "CONTINUOUS PROPELLER"
    : `CHANNEL ${mode.toUpperCase()}`;
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(" ", "-");
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Missing contact sound library element: ${selector}`);
  }
  return element;
}
