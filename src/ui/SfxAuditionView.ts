import {
  AudioSessionCoordinator,
  mayOwnAudioSession,
  mayUseAudioAtLocation,
  type AudioSessionOutput,
} from "../game/AudioSessionCoordinator";
import {
  formatSfxAuditionReport,
  SFX_AUDITION_DECISIONS,
  SFX_AUDITION_ITEMS,
  type SfxAuditionDecision,
  type SfxAuditionItem,
} from "./sfxAuditionCatalog";

// v2 starts from the completed 2026-08-18 listening decision. Keep v1 data in
// localStorage untouched rather than letting an older partial pass override it.
const STORAGE_KEY = "akula-sfx-audition-decisions-v2";

type PlaybackState = "idle" | "paused" | "playing";

export class SfxAuditionView {
  private readonly abortController = new AbortController();
  private readonly output: SfxAuditionOutput;
  private readonly audioSession: AudioSessionCoordinator;
  private readonly status: HTMLOutputElement;
  private readonly report: HTMLElement;
  private readonly keepCount: HTMLOutputElement;
  private readonly rejectCount: HTMLOutputElement;
  private readonly undecidedCount: HTMLOutputElement;
  private readonly volumeValue: HTMLOutputElement;
  private readonly itemById = new Map(
    SFX_AUDITION_ITEMS.map((item) => [item.id, item] as const),
  );
  private readonly decisions: Record<string, SfxAuditionDecision>;
  private activeItem: SfxAuditionItem | undefined;
  private playbackState: PlaybackState = "idle";
  private disposed = false;

  public constructor(private readonly root: HTMLElement) {
    this.decisions = loadDecisions();
    root.replaceChildren();
    root.className = "sfx-audition";
    root.innerHTML = createSfxAuditionMarkup();

    this.status = requireElement<HTMLOutputElement>(
      root,
      '[data-testid="sfx-audition-status"]',
    );
    this.report = requireElement<HTMLElement>(root, "[data-sfx-report]");
    this.keepCount = requireElement<HTMLOutputElement>(
      root,
      '[data-count="keep"]',
    );
    this.rejectCount = requireElement<HTMLOutputElement>(
      root,
      '[data-count="reject"]',
    );
    this.undecidedCount = requireElement<HTMLOutputElement>(
      root,
      '[data-count="undecided"]',
    );
    this.volumeValue = requireElement<HTMLOutputElement>(
      root,
      "[data-volume-value]",
    );

    this.output = new SfxAuditionOutput(this.handleSessionInterrupted);
    this.audioSession = new AudioSessionCoordinator(this.output);
    this.bindAudioEvents();
    this.renderDecisions();
    this.setVolume(65);

    document.title = "AKULA · Banco d’ascolto SFX 01–37";
    root.addEventListener("click", this.handleClick, {
      signal: this.abortController.signal,
    });
    root.addEventListener("input", this.handleInput, {
      signal: this.abortController.signal,
    });
    globalThis.addEventListener("pagehide", () => this.dispose(), {
      once: true,
      signal: this.abortController.signal,
    });
  }

  public initialize(): Promise<void> {
    if (!mayUseAudioAtLocation(globalThis.location)) {
      this.status.value =
        "AUDIO BLOCCATO · APRI QUESTA PAGINA SU 127.0.0.1:4173";
      return Promise.resolve();
    }
    this.status.value =
      "PRONTO · PREMI PLAY · UN SOLO EFFETTO PUÒ SUONARE ALLA VOLTA";
    return Promise.resolve();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.abortController.abort();
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

    switch (button.dataset["action"]) {
      case "play": {
        const item = this.itemById.get(button.dataset["sfxId"] ?? "");
        if (item !== undefined) {
          void this.togglePlayback(item);
        }
        break;
      }
      case "decision": {
        const item = this.itemById.get(button.dataset["sfxId"] ?? "");
        const decision = button.dataset["decision"];
        if (item !== undefined && isSfxDecision(decision)) {
          this.setDecision(item, decision);
        }
        break;
      }
      case "stop":
        this.stopPlayback();
        break;
      case "copy":
        void this.copyReport();
        break;
      case "reset":
        this.resetDecisions();
        break;
    }
  };

  private readonly handleInput = (event: Event): void => {
    const target = event.target;
    if (
      target instanceof HTMLInputElement &&
      target.dataset["action"] === "volume"
    ) {
      this.setVolume(Number(target.value));
    }
  };

  private readonly handleSessionInterrupted = (): void => {
    if (this.playbackState === "playing") {
      this.playbackState = "paused";
      this.renderPlaybackState();
      this.status.value =
        "IN PAUSA · UN’ALTRA ISTANZA AKULA HA PRESO L’AUDIO O LA PAGINA NON È IN PRIMO PIANO";
    }
  };

  private readonly handleTimeUpdate = (): void => {
    if (this.activeItem === undefined) {
      return;
    }
    const row = this.rowFor(this.activeItem.id);
    const progress = requireElement<HTMLElement>(row, "[data-progress]");
    const fill = requireElement<HTMLElement>(row, "[data-progress-fill]");
    const time = requireElement<HTMLOutputElement>(row, "[data-time]");
    const duration = finiteDuration(
      this.output.audio.duration,
      this.activeItem.durationSeconds,
    );
    const currentTime = Math.min(this.output.audio.currentTime, duration);
    const ratio = duration <= 0 ? 0 : currentTime / duration;
    fill.style.width = `${(ratio * 100).toFixed(3)}%`;
    progress.setAttribute("aria-valuenow", currentTime.toFixed(2));
    progress.setAttribute("aria-valuemax", duration.toFixed(2));
    time.value = `${formatTime(currentTime)} / ${formatTime(duration)}`;
  };

  private readonly handleEnded = (): void => {
    if (this.activeItem === undefined) {
      return;
    }
    const completed = this.activeItem;
    this.playbackState = "idle";
    this.renderPlaybackState();
    this.status.value = `${formatNumber(completed.number)} COMPLETATO · ${completed.title.toUpperCase()}`;
  };

  private readonly handleAudioError = (): void => {
    const failed = this.activeItem;
    this.playbackState = "idle";
    this.renderPlaybackState();
    this.status.value =
      failed === undefined
        ? "CARICAMENTO AUDIO FALLITO"
        : `${formatNumber(failed.number)} NON DISPONIBILE · CONTROLLA IL MASTER LOCALE`;
  };

  private bindAudioEvents(): void {
    this.output.audio.addEventListener("timeupdate", this.handleTimeUpdate, {
      signal: this.abortController.signal,
    });
    this.output.audio.addEventListener(
      "loadedmetadata",
      this.handleTimeUpdate,
      {
        signal: this.abortController.signal,
      },
    );
    this.output.audio.addEventListener("ended", this.handleEnded, {
      signal: this.abortController.signal,
    });
    this.output.audio.addEventListener("error", this.handleAudioError, {
      signal: this.abortController.signal,
    });
  }

  private async togglePlayback(item: SfxAuditionItem): Promise<void> {
    if (this.disposed) {
      return;
    }
    if (!mayUseAudioAtLocation(globalThis.location)) {
      this.status.value =
        "AUDIO BLOCCATO · USA http://127.0.0.1:4173/?sfx-audition=1";
      return;
    }
    if (!mayOwnAudioSession(document.visibilityState, document.hasFocus())) {
      this.status.value =
        "PORTA QUESTA PAGINA IN PRIMO PIANO, POI PREMI DI NUOVO PLAY";
      return;
    }

    if (this.activeItem?.id === item.id) {
      if (this.playbackState === "playing") {
        this.output.pause();
        this.playbackState = "paused";
        this.renderPlaybackState();
        this.status.value = `${formatNumber(item.number)} IN PAUSA · ${item.title.toUpperCase()}`;
        return;
      }
      try {
        await this.audioSession.resumeFromUserGesture();
        await this.output.resumePlayback();
        this.playbackState = "playing";
        this.renderPlaybackState();
        this.status.value = `${formatNumber(item.number)} IN RIPRODUZIONE · ${item.title.toUpperCase()}`;
      } catch (error) {
        this.handlePlaybackFailure(item, error);
      }
      return;
    }

    this.clearProgress(this.activeItem);
    this.activeItem = item;
    this.playbackState = "paused";
    this.renderPlaybackState();
    this.status.value = `${formatNumber(item.number)} CARICAMENTO · ${item.title.toUpperCase()}`;

    try {
      await this.audioSession.resumeFromUserGesture();
      await this.output.play(item.assetPath);
      if (this.disposed || this.activeItem?.id !== item.id) {
        return;
      }
      this.playbackState = "playing";
      this.renderPlaybackState();
      this.status.value = `${formatNumber(item.number)} IN RIPRODUZIONE · ${item.title.toUpperCase()}`;
    } catch (error) {
      this.handlePlaybackFailure(item, error);
    }
  }

  private handlePlaybackFailure(item: SfxAuditionItem, error: unknown): void {
    if (this.activeItem?.id !== item.id) {
      return;
    }
    this.playbackState = "idle";
    this.renderPlaybackState();
    this.status.value = `${formatNumber(item.number)} RIPRODUZIONE FALLITA · CONTROLLA IL MASTER LOCALE`;
    console.error("Unable to play the selected AKULA research SFX.", error);
  }

  private stopPlayback(): void {
    this.output.stop();
    this.clearProgress(this.activeItem);
    this.activeItem = undefined;
    this.playbackState = "idle";
    this.renderPlaybackState();
    this.status.value = "FERMO · SILENZIO DIGITALE";
  }

  private renderPlaybackState(): void {
    for (const item of SFX_AUDITION_ITEMS) {
      const row = this.rowFor(item.id);
      const button = requireElement<HTMLButtonElement>(
        row,
        'button[data-action="play"]',
      );
      const label = requireElement<HTMLElement>(button, "[data-play-label]");
      const isActive = this.activeItem?.id === item.id;
      const isPlaying = isActive && this.playbackState === "playing";
      const isPaused = isActive && this.playbackState === "paused";
      row.dataset["playback"] = isPlaying
        ? "playing"
        : isPaused
          ? "paused"
          : "idle";
      button.setAttribute("aria-pressed", String(isPlaying));
      label.textContent = isPlaying ? "PAUSA" : isPaused ? "RIPRENDI" : "PLAY";
    }
  }

  private clearProgress(item: SfxAuditionItem | undefined): void {
    if (item === undefined) {
      return;
    }
    const row = this.rowFor(item.id);
    const progress = requireElement<HTMLElement>(row, "[data-progress]");
    const fill = requireElement<HTMLElement>(row, "[data-progress-fill]");
    const time = requireElement<HTMLOutputElement>(row, "[data-time]");
    fill.style.width = "0%";
    progress.setAttribute("aria-valuenow", "0");
    time.value = `00:00 / ${formatTime(item.durationSeconds)}`;
  }

  private setDecision(
    item: SfxAuditionItem,
    decision: SfxAuditionDecision,
  ): void {
    this.decisions[item.id] = decision;
    saveDecisions(this.decisions);
    this.renderDecisions();
    this.status.value = `${formatNumber(item.number)} · ${decisionLabel(decision)} · ${item.title.toUpperCase()}`;
  }

  private renderDecisions(): void {
    let keep = 0;
    let reject = 0;
    let undecided = 0;

    for (const item of SFX_AUDITION_ITEMS) {
      const decision = this.decisions[item.id] ?? "undecided";
      const row = this.rowFor(item.id);
      row.dataset["decision"] = decision;
      for (const button of row.querySelectorAll<HTMLButtonElement>(
        'button[data-action="decision"]',
      )) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset["decision"] === decision),
        );
      }
      if (decision === "keep") {
        keep += 1;
      } else if (decision === "reject") {
        reject += 1;
      } else {
        undecided += 1;
      }
    }

    this.keepCount.value = String(keep).padStart(2, "0");
    this.rejectCount.value = String(reject).padStart(2, "0");
    this.undecidedCount.value = String(undecided).padStart(2, "0");
    this.report.textContent = formatSfxAuditionReport(this.decisions);
  }

  private async copyReport(): Promise<void> {
    const text = formatSfxAuditionReport(this.decisions);
    try {
      await navigator.clipboard.writeText(text);
      this.status.value =
        "LISTA COPIATA · INCOLLALA NELLA CHAT PER DIRMI COSA TENERE E SCARTARE";
    } catch (error) {
      this.status.value =
        "COPIA AUTOMATICA NON DISPONIBILE · SELEZIONA IL TESTO NEL RIEPILOGO";
      console.warn("Unable to copy the AKULA SFX audition report.", error);
    }
  }

  private resetDecisions(): void {
    if (!globalThis.confirm("Azzerare tutte le scelte Tieni / Scarta?")) {
      return;
    }
    for (const item of SFX_AUDITION_ITEMS) {
      this.decisions[item.id] = "undecided";
    }
    saveDecisions(this.decisions);
    this.renderDecisions();
    this.status.value = "SCELTE AZZERATE · 37 EFFETTI DA VALUTARE";
  }

  private setVolume(value: number): void {
    const safeValue = Math.min(100, Math.max(0, value));
    this.output?.setVolume(safeValue / 100);
    this.volumeValue.value = String(Math.round(safeValue));
  }

  private rowFor(itemId: string): HTMLElement {
    return requireElement<HTMLElement>(this.root, `[data-sfx-id="${itemId}"]`);
  }
}

class SfxAuditionOutput implements AudioSessionOutput {
  public readonly audio = new Audio();
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private readonly source: MediaElementAudioSourceNode;
  private readonly volume: GainNode;
  private readonly sessionGate: GainNode;
  private disposed = false;

  public constructor(private readonly onSessionInterrupted: () => void) {
    this.audio.preload = "metadata";
    this.source = this.context.createMediaElementSource(this.audio);
    this.volume = this.context.createGain();
    this.sessionGate = this.context.createGain();
    this.volume.gain.value = 0.65;
    this.sessionGate.gain.value = 0;
    this.source
      .connect(this.volume)
      .connect(this.sessionGate)
      .connect(this.context.destination);
  }

  public setSessionActive(active: boolean): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    this.sessionGate.gain.cancelScheduledValues(now);
    if (!active) {
      this.sessionGate.gain.setValueAtTime(0, now);
      if (!this.audio.paused) {
        this.audio.pause();
        this.onSessionInterrupted();
      }
      return;
    }
    this.sessionGate.gain.setValueAtTime(0, now);
    this.sessionGate.gain.linearRampToValueAtTime(1, now + 0.02);
  }

  public async resume(): Promise<void> {
    if (!this.disposed && this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  public async play(assetPath: string): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.audio.pause();
    this.audio.src = assetPath;
    this.audio.currentTime = 0;
    this.audio.load();
    await this.audio.play();
  }

  public async resumePlayback(): Promise<void> {
    if (!this.disposed) {
      if (this.audio.ended) {
        this.audio.currentTime = 0;
      }
      await this.audio.play();
    }
  }

  public pause(): void {
    this.audio.pause();
  }

  public stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
  }

  public setVolume(value: number): void {
    if (this.disposed) {
      return;
    }
    const now = this.context.currentTime;
    this.volume.gain.cancelScheduledValues(now);
    this.volume.gain.setTargetAtTime(value, now, 0.015);
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.source.disconnect();
    this.volume.disconnect();
    this.sessionGate.disconnect();
    void this.context.close();
  }
}

function createSfxAuditionMarkup(): string {
  return `
    <div class="sfx-audition-shell">
      <header class="sfx-audition-head">
        <div>
          <span class="sfx-audition-kicker">AKULA / SOURCE AUDIO LAB / CC0 MASTERS</span>
          <h1>BANCO D’ASCOLTO <strong>01–37</strong></h1>
          <p>Premi PLAY, ascolta il master e marca TIENI, SCARTA oppure INCERTO. Le scelte rimangono in questo browser e un solo effetto può suonare alla volta.</p>
        </div>
        <div class="sfx-head-actions">
          <label class="sfx-volume-control">
            <span>VOLUME</span>
            <input type="range" min="0" max="100" value="65" step="1" data-action="volume" aria-label="Volume di ascolto" />
            <output data-volume-value>65</output>
          </label>
          <button type="button" class="sfx-stop" data-action="stop">STOP</button>
        </div>
      </header>

      <section class="sfx-audition-summary" aria-label="Riepilogo selezione">
        <div><output data-count="keep">00</output><span>TIENI</span></div>
        <div><output data-count="reject">00</output><span>SCARTA</span></div>
        <div><output data-count="undecided">37</output><span>INCERTI</span></div>
        <div class="sfx-summary-actions">
          <button type="button" data-action="copy">COPIA LISTA</button>
          <button type="button" data-action="reset">AZZERA SCELTE</button>
        </div>
      </section>

      <main class="sfx-audition-list" aria-label="37 effetti sonori da valutare">
        ${SFX_AUDITION_ITEMS.map(sfxRowMarkup).join("")}
      </main>

      <details class="sfx-report-panel">
        <summary>RIEPILOGO TESTUALE DA INCOLLARE IN CHAT</summary>
        <pre data-sfx-report></pre>
      </details>

      <aside class="sfx-source-note">
        <strong>SORGENTI DI RICERCA</strong>
        <p>Master WAV mono 48 kHz / 24-bit dalla USC Optical Sound Effects Library. Sono registrazioni archivistiche non restaurate: la decisione finale è percettiva, non tecnica.</p>
      </aside>
    </div>
    <footer class="sfx-audition-footer">
      <output data-testid="sfx-audition-status" aria-live="polite">INIZIALIZZAZIONE</output>
      <span>UN SOLO MASTER ATTIVO · AUDIO LOCALE 127.0.0.1:4173</span>
    </footer>
  `;
}

function sfxRowMarkup(item: SfxAuditionItem): string {
  const number = formatNumber(item.number);
  const duration = formatTime(item.durationSeconds);
  return `
    <article class="sfx-audition-row" data-sfx-id="${item.id}" data-decision="undecided" data-playback="idle">
      <span class="sfx-row-number" aria-label="Effetto ${number}">${number}</span>
      <button type="button" class="sfx-play" data-action="play" data-sfx-id="${item.id}" aria-label="Riproduci ${escapeHtml(item.title)}" aria-pressed="false">
        <i aria-hidden="true"></i>
        <span data-play-label>PLAY</span>
      </button>
      <div class="sfx-row-copy">
        <div class="sfx-row-heading">
          <h2>${escapeHtml(item.title)}</h2>
          <span>${escapeHtml(item.category)}</span>
        </div>
        <p>${escapeHtml(item.sourceTitle)}</p>
        <div class="sfx-playback-meter">
          <div class="sfx-progress" data-progress role="progressbar" aria-label="Avanzamento ${escapeHtml(item.title)}" aria-valuemin="0" aria-valuemax="${item.durationSeconds}" aria-valuenow="0">
            <i data-progress-fill></i>
          </div>
          <output data-time>00:00 / ${duration}</output>
        </div>
      </div>
      <div class="sfx-decision" role="group" aria-label="Decisione per effetto ${number}">
        ${decisionButton(item.id, "keep", "TIENI")}
        ${decisionButton(item.id, "reject", "SCARTA")}
        ${decisionButton(item.id, "undecided", "INCERTO", true)}
      </div>
    </article>
  `;
}

function decisionButton(
  itemId: string,
  decision: SfxAuditionDecision,
  label: string,
  pressed = false,
): string {
  return `<button type="button" data-action="decision" data-sfx-id="${itemId}" data-decision="${decision}" aria-pressed="${String(pressed)}">${label}</button>`;
}

function loadDecisions(): Record<string, SfxAuditionDecision> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) {
      return { ...SFX_AUDITION_DECISIONS };
    }
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, SfxAuditionDecision] =>
          isSfxDecision(entry[1]),
      ),
    );
  } catch {
    return {};
  }
}

function saveDecisions(
  decisions: Readonly<Record<string, SfxAuditionDecision>>,
): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions));
  } catch (error) {
    console.warn("Unable to persist AKULA SFX audition decisions.", error);
  }
}

function isSfxDecision(value: unknown): value is SfxAuditionDecision {
  return value === "keep" || value === "reject" || value === "undecided";
}

function decisionLabel(decision: SfxAuditionDecision): string {
  if (decision === "keep") {
    return "TIENI";
  }
  if (decision === "reject") {
    return "SCARTA";
  }
  return "INCERTO";
}

function formatNumber(value: number): string {
  return String(value).padStart(2, "0");
}

function formatTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = Math.floor(safeSeconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function finiteDuration(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function requireElement<ElementType extends Element>(
  root: ParentNode,
  selector: string,
): ElementType {
  const element = root.querySelector<ElementType>(selector);
  if (element === null) {
    throw new Error(`Missing SFX audition element: ${selector}`);
  }
  return element;
}
