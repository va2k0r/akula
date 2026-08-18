import type { AcousticCode, AcousticSignatureEngine } from "../audio";
import { AcousticSignatureScope } from "../visualization";
import type { ContactTrackSnapshot } from "./ContactTracker";
import {
  FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS,
  FROSTBITE_CONTACT_SIGNATURE,
} from "./ContactSignature";
import type { ControlFrame } from "./InputController";
import { type PassiveSonarMeasurement } from "./SonarLogic";

interface SonarStationOptions {
  readonly onApplyHypothesis: (
    trackId: string,
    signatureCode: AcousticCode,
  ) => ContactTrackSnapshot;
  readonly onRequestClose: () => void;
}

const INITIAL_HYPOTHESIS: AcousticCode = [1, 2, 3];

/** Contact identification station with no correctness feedback path. */
export class SonarStation {
  private readonly abortController = new AbortController();
  private readonly scope: AcousticSignatureScope;
  private readonly digits: readonly HTMLButtonElement[];
  private readonly status: HTMLElement;
  private answer: AcousticCode = INITIAL_HYPOTHESIS;
  private selectedDigit = 0;
  private listeningValue = false;
  private focusedValue = false;
  private activeTrackValue: ContactTrackSnapshot | undefined;
  private latestMeasurement: PassiveSonarMeasurement | undefined;

  public constructor(
    private readonly panel: HTMLElement,
    private readonly engine: AcousticSignatureEngine,
    private readonly options: SonarStationOptions,
  ) {
    panel.innerHTML = `
      <div class="sonar-head">
        <span>BEAT VOLUME · A+B+C</span>
        <span class="sonar-sweep-state" aria-label="History moves from right to left">
          <b aria-hidden="true">←</b>
          <i class="sonar-mode" data-testid="sonar-mode">STANDBY</i>
        </span>
      </div>
      <canvas class="signature-scope" data-testid="acoustic-scope" role="img" aria-label="Symmetric live beat-volume histogram; new contact samples enter on the right and history moves left"></canvas>

      <div class="sonar-code-layout">
        <div class="sonar-code-column">
          <span class="sonar-label">ACOUSTIC CODE</span>
          <div class="code-entry" role="group" aria-label="Acoustic class signature hypothesis">
            ${[0, 1, 2]
              .map(
                (index) => `
                  <span class="digit-stack">
                    <button type="button" class="digit-step" data-step="1" data-index="${index}" aria-label="Increase acoustic digit ${index + 1}">+</button>
                    <button type="button" class="sonar-digit" data-index="${index}" aria-label="Acoustic digit ${index + 1}">1</button>
                    <button type="button" class="digit-step" data-step="-1" data-index="${index}" aria-label="Decrease acoustic digit ${index + 1}">−</button>
                  </span>
                `,
              )
              .join("")}
          </div>
          <small class="code-hint">D-PAD ◀▶ SELECT · ▲▼ CHANGE</small>
        </div>
        <div class="sonar-actions">
          <button type="button" class="classify-contact" data-action="submit" data-testid="classify-contact">
            <b>A</b><span>APPLY</span>
          </button>
          <button type="button" class="sonar-close" data-action="close-sonar" aria-label="Close contact analysis without applying changes">
            <b>B</b><span>CLOSE</span>
          </button>
        </div>
      </div>
      <p class="sonar-status" data-testid="sonar-status">D-PAD to form a three-rate hypothesis.</p>
    `;

    const canvas = requireElement<HTMLCanvasElement>(panel, "canvas");
    this.digits = Array.from(
      panel.querySelectorAll<HTMLButtonElement>(".sonar-digit"),
    );
    this.status = requireElement(panel, '[data-testid="sonar-status"]');
    this.scope = new AcousticSignatureScope(canvas, {
      signalQuality: 0.2,
      historySeconds: 5.2,
      samplesPerSecond: 54,
      transparentBackground: true,
      playbackTime: () => this.engine.getPlaybackElapsedTime(),
    });
    this.engine.setSignature(FROSTBITE_CONTACT_SIGNATURE);
    this.engine.setCycleDuration(FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS);
    this.scope.setSignature(FROSTBITE_CONTACT_SIGNATURE);
    this.scope.setCycleDuration(FROSTBITE_CONTACT_CYCLE_DURATION_SECONDS);

    for (const digit of this.digits) {
      digit.addEventListener(
        "click",
        () => {
          this.selectedDigit = Number(digit.dataset["index"] ?? 0);
          this.renderDigits();
        },
        { signal: this.abortController.signal },
      );
    }
    for (const step of panel.querySelectorAll<HTMLButtonElement>(
      ".digit-step",
    )) {
      step.addEventListener(
        "click",
        () => {
          const index = Number(step.dataset["index"] ?? 0);
          const delta = Number(step.dataset["step"] ?? 0);
          this.selectedDigit = index;
          this.changeDigit(delta);
        },
        { signal: this.abortController.signal },
      );
    }
    requireElement<HTMLButtonElement>(
      panel,
      '[data-action="close-sonar"]',
    ).addEventListener("click", () => this.cancelAndClose(), {
      signal: this.abortController.signal,
    });
    requireElement<HTMLButtonElement>(
      panel,
      '[data-action="submit"]',
    ).addEventListener("click", () => this.submit(), {
      signal: this.abortController.signal,
    });
    this.setFocused(false);
    this.renderDigits();
  }

  public get listening(): boolean {
    return this.listeningValue;
  }

  public get focused(): boolean {
    return this.focusedValue;
  }

  public get classified(): boolean {
    return this.activeTrackValue?.identification !== undefined;
  }

  public async start(): Promise<void> {
    if (this.listeningValue) {
      return;
    }
    this.listeningValue = true;
    await this.engine.play();
    this.scope.play();
    requireElement(this.panel, '[data-testid="sonar-mode"]').textContent =
      "LIVE";
    this.panel.classList.add("listening");
  }

  public setActiveTrack(track: ContactTrackSnapshot | undefined): void {
    const changed = track?.id !== this.activeTrackValue?.id;
    this.activeTrackValue = track;
    if (changed) {
      this.resetDraft();
    }
    this.renderTrackState();
  }

  public setFocused(focused: boolean): void {
    this.focusedValue = focused;
    if (focused) {
      this.resetDraft();
    }
    this.panel.classList.toggle("focused", focused);
    this.panel.setAttribute("aria-hidden", String(!focused));
    this.panel.inert = !focused;
  }

  /** Stacks analysis below the projected bearing label at every screen bearing. */
  public setScreenAnchor(
    screenX: number,
    screenY: number,
    viewportWidth: number,
    viewportHeight: number,
  ): void {
    const padding = 14;
    const gap = 22;
    const panelWidth = Math.min(410, Math.max(300, viewportWidth * 0.34));
    const panelHeight = 270;
    const left = clamp(
      screenX - panelWidth * 0.5,
      padding,
      Math.max(padding, viewportWidth - panelWidth - padding),
    );
    const top = clamp(
      screenY + gap,
      padding,
      Math.max(padding, viewportHeight - panelHeight - padding),
    );

    this.panel.dataset["placement"] = "below";
    this.panel.style.left = `${left.toFixed(1)}px`;
    this.panel.style.top = `${top.toFixed(1)}px`;
    this.panel.style.setProperty(
      "--anchor-offset-x",
      `${clamp(screenX - left, 8, panelWidth - 8).toFixed(1)}px`,
    );
    this.panel.style.setProperty(
      "--anchor-offset-y",
      `${clamp(screenY - top, 8, panelHeight - 8).toFixed(1)}px`,
    );
  }

  public handleInput(frame: ControlFrame): void {
    if (!this.focusedValue || this.activeTrackValue === undefined) {
      return;
    }
    if (frame.cancel) {
      this.cancelAndClose();
      return;
    }
    if (frame.digitSelectDelta !== 0) {
      this.selectedDigit =
        (this.selectedDigit + frame.digitSelectDelta + 3) % 3;
      this.renderDigits();
    }
    if (frame.digitValueDelta !== 0) {
      this.changeDigit(frame.digitValueDelta);
    }
    if (frame.directDigit !== undefined) {
      this.setDigitDistinct(frame.directDigit);
      this.selectedDigit = (this.selectedDigit + 1) % 3;
      this.renderDigits();
    }
    if (frame.submit) {
      this.submit();
    }
  }

  public update(measurement: PassiveSonarMeasurement): void {
    this.latestMeasurement = measurement;
    this.scope.setSignalQuality(measurement.signalQuality);
    this.panel.style.setProperty(
      "--signal-quality",
      String(measurement.signalQuality),
    );
    this.panel.classList.toggle("poor-signal", !measurement.perceivable);
    this.renderTrackState();
  }

  public dispose(): void {
    this.abortController.abort();
    this.scope.dispose();
  }

  private changeDigit(delta: number): void {
    let next = this.answer[this.selectedDigit] ?? 1;
    for (let attempt = 0; attempt < 9; attempt += 1) {
      next = ((next - 1 + delta + 9) % 9) + 1;
      if (
        this.answer.every(
          (value, index) => index === this.selectedDigit || value !== next,
        )
      ) {
        break;
      }
    }
    this.answer = replaceCodeValue(this.answer, this.selectedDigit, next);
    this.renderDigits();
  }

  private setDigitDistinct(value: number): void {
    const duplicateIndex = this.answer.findIndex(
      (current, index) => index !== this.selectedDigit && current === value,
    );
    if (duplicateIndex < 0) {
      this.answer = replaceCodeValue(this.answer, this.selectedDigit, value);
      return;
    }
    const previous = this.answer[this.selectedDigit] ?? 1;
    this.answer = replaceCodeValue(this.answer, duplicateIndex, previous);
    this.answer = replaceCodeValue(this.answer, this.selectedDigit, value);
  }

  private submit(): void {
    const track = this.activeTrackValue;
    if (track === undefined) {
      return;
    }
    this.activeTrackValue = this.options.onApplyHypothesis(
      track.id,
      this.answer,
    );
    this.renderTrackState();
    const speed = this.activeTrackValue.identification?.estimatedSpeedKt;
    this.status.textContent =
      speed === undefined
        ? "Operational hypothesis accepted."
        : `HYPOTHESIS APPLIED · ${speed.toFixed(1)} KT ASSUMED · TMA REBUILT`;
  }

  private cancelAndClose(): void {
    this.resetDraft();
    this.options.onRequestClose();
  }

  private resetDraft(): void {
    const applied = this.activeTrackValue?.identification?.signatureCode;
    this.answer =
      applied === undefined ? INITIAL_HYPOTHESIS : copyCode(applied);
    this.selectedDigit = 0;
    this.renderDigits();
  }

  private renderTrackState(): void {
    const track = this.activeTrackValue;
    if (track === undefined) {
      this.status.textContent = "Acquire a source from the external camera.";
      return;
    }
    if (track.status === "LOST") {
      this.status.textContent =
        "TRACK LOST · bearing history and projected solution retained.";
      return;
    }
    if (track.identification !== undefined) {
      this.status.textContent = `CLASSIFIED · ${track.identification.guessedClassName.toUpperCase()} · ${track.identification.estimatedSpeedKt.toFixed(1)} KT EST · ${track.observations.length.toString()} BEARINGS`;
      return;
    }
    this.status.textContent =
      this.latestMeasurement?.perceivable === false
        ? "SIGNAL MASKED · no new bearing recorded."
        : `${track.observations.length.toString()} BEARINGS · no correctness response.`;
  }

  private renderDigits(): void {
    for (const [index, digit] of this.digits.entries()) {
      digit.textContent = String(this.answer[index] ?? 1);
      digit.classList.toggle("selected", index === this.selectedDigit);
      digit.setAttribute("aria-pressed", String(index === this.selectedDigit));
    }
  }
}

function replaceCodeValue(
  code: AcousticCode,
  index: number,
  value: number,
): AcousticCode {
  const next: [number, number, number] = [code[0], code[1], code[2]];
  if (index === 0 || index === 1 || index === 2) {
    next[index] = value;
  }
  return next;
}

function copyCode(code: AcousticCode): AcousticCode {
  return [code[0], code[1], code[2]];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function requireElement<T extends Element = HTMLElement>(
  root: ParentNode,
  selector: string,
): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing sonar UI element: ${selector}`);
  }
  return element;
}
