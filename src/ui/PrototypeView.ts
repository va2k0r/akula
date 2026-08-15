import type { AcousticCode, AcousticSignatureEngine } from "../audio";
import { AcousticSignatureScope } from "../visualization";

const MINIMUM_VALUE = 0;
const MAXIMUM_VALUE = 24;
const DEFAULT_CYCLE_DURATION = 4.5;
interface NumericSelector {
  readonly element: HTMLDivElement;
  readonly value: () => number;
  readonly setValue: (value: number) => void;
}

export class PrototypeView {
  private readonly abortController = new AbortController();
  private readonly selectors: readonly NumericSelector[];
  private readonly scope: AcousticSignatureScope;
  private activeCode: AcousticCode;
  private activeCycleDuration: number;
  private playbackRequestId = 0;

  public constructor(
    root: HTMLElement,
    private readonly engine: AcousticSignatureEngine,
    private readonly initialCode: AcousticCode,
    signalQuality: number,
    private readonly cycleDuration = DEFAULT_CYCLE_DURATION,
  ) {
    root.replaceChildren();
    this.activeCode = initialCode;
    this.activeCycleDuration = cycleDuration;

    const controls = document.createElement("div");
    controls.className = "prototype-controls";

    const playback = document.createElement("div");
    playback.className = "playback-controls";
    const playButton = createButton("PLAY");
    const pauseButton = createButton("PAUSE");
    playback.append(playButton, pauseButton);

    const scopeCanvas = document.createElement("canvas");
    scopeCanvas.className = "signature-scope";
    scopeCanvas.setAttribute("role", "img");
    scopeCanvas.setAttribute(
      "aria-label",
      "Combined acoustic modulation envelope",
    );

    const selectorsElement = document.createElement("div");
    selectorsElement.className = "selectors";
    this.selectors = initialCode.map((value, index) =>
      createNumericSelector(value, index, this.abortController.signal),
    );
    selectorsElement.append(
      ...this.selectors.map((selector) => selector.element),
    );

    const okButton = createButton("OK");
    const resetButton = createButton("RESET");
    const answerControls = document.createElement("div");
    answerControls.className = "answer-controls";
    answerControls.append(okButton, resetButton);

    controls.append(playback, scopeCanvas, selectorsElement, answerControls);
    root.append(controls);

    this.scope = new AcousticSignatureScope(scopeCanvas, {
      signalQuality,
      playbackTime: () => this.engine.getPlaybackElapsedTime(),
    });

    this.engine.setSignature(initialCode);
    this.engine.setCycleDuration(cycleDuration);
    this.scope.setSignature(initialCode);
    this.scope.setCycleDuration(cycleDuration);

    playButton.addEventListener(
      "click",
      () => {
        void this.play();
      },
      { signal: this.abortController.signal },
    );
    pauseButton.addEventListener(
      "click",
      () => {
        this.pausePlayback();
      },
      { signal: this.abortController.signal },
    );
    okButton.addEventListener(
      "click",
      () => {
        void this.generate();
      },
      { signal: this.abortController.signal },
    );
    resetButton.addEventListener(
      "click",
      () => {
        void this.reset();
      },
      { signal: this.abortController.signal },
    );
  }

  public dispose(): void {
    this.abortController.abort();
    this.scope.dispose();
    this.engine.dispose();
  }

  private async play(): Promise<void> {
    await this.startSignature();
  }

  private async reset(): Promise<void> {
    this.pausePlayback();
    this.activeCode = this.initialCode;
    this.activeCycleDuration = this.cycleDuration;
    this.selectors.forEach((selector, index) => {
      selector.setValue(this.initialCode[index] ?? MINIMUM_VALUE);
    });
    await this.startSignature();
  }

  private async generate(): Promise<void> {
    this.pausePlayback();
    const values = this.selectors.map((selector) => selector.value());
    this.activeCode = [
      values[0] ?? MINIMUM_VALUE,
      values[1] ?? MINIMUM_VALUE,
      values[2] ?? MINIMUM_VALUE,
    ];
    await this.startSignature();
  }

  private async startSignature(): Promise<void> {
    const requestId = this.playbackRequestId + 1;
    this.playbackRequestId = requestId;
    this.engine.setSignature(this.activeCode);
    this.engine.setCycleDuration(this.activeCycleDuration);
    this.scope.setSignature(this.activeCode);
    this.scope.setCycleDuration(this.activeCycleDuration);

    try {
      await this.engine.play();
      if (requestId === this.playbackRequestId) {
        this.scope.play();
      }
    } catch (error: unknown) {
      console.error("Unable to start the acoustic signature.", error);
    }
  }

  private pausePlayback(): void {
    this.playbackRequestId += 1;
    this.scope.pause();
    this.engine.pause();
  }
}

function createNumericSelector(
  initialValue: number,
  index: number,
  signal: AbortSignal,
): NumericSelector {
  let value = initialValue;
  const element = document.createElement("div");
  element.className = "selector";
  element.tabIndex = 0;
  element.setAttribute("role", "spinbutton");
  element.setAttribute("aria-label", `Value ${index + 1}`);
  element.setAttribute("aria-valuemin", String(MINIMUM_VALUE));
  element.setAttribute("aria-valuemax", String(MAXIMUM_VALUE));

  const incrementButton = createButton("▲");
  incrementButton.className = "arrow";
  incrementButton.setAttribute("aria-label", `Increase value ${index + 1}`);
  const display = document.createElement("span");
  display.className = "selector-value";
  display.setAttribute("aria-hidden", "true");
  const decrementButton = createButton("▼");
  decrementButton.className = "arrow";
  decrementButton.setAttribute("aria-label", `Decrease value ${index + 1}`);
  element.append(incrementButton, display, decrementButton);

  const render = (): void => {
    display.textContent = String(value);
    element.setAttribute("aria-valuenow", String(value));
  };
  const change = (delta: number): void => {
    value = Math.min(MAXIMUM_VALUE, Math.max(MINIMUM_VALUE, value + delta));
    render();
  };

  incrementButton.addEventListener("click", () => change(1), { signal });
  decrementButton.addEventListener("click", () => change(-1), { signal });
  element.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        change(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        change(-1);
      }
    },
    { signal },
  );

  render();
  return {
    element,
    value: () => value,
    setValue: (nextValue: number) => {
      value = Math.min(MAXIMUM_VALUE, Math.max(MINIMUM_VALUE, nextValue));
      render();
    },
  };
}

function createButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  return button;
}
