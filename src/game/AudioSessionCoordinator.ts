const AUDIO_SESSION_CHANNEL_NAME = "akula-audio-session-v1";
const CANONICAL_LOCAL_AUDIO_PORT = "4173";

interface AudioSessionClaim {
  readonly type: "claim";
  readonly ownerId: string;
}

export interface AudioSessionOutput {
  setSessionActive(active: boolean): void;
  resume(): Promise<void>;
}

export interface AudioSessionEventTarget {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface AudioSessionDocument extends AudioSessionEventTarget {
  readonly visibilityState: DocumentVisibilityState;
  hasFocus(): boolean;
}

export interface AudioSessionLocation {
  readonly protocol: string;
  readonly hostname: string;
  readonly port: string;
}

export interface AudioSessionChannel extends AudioSessionEventTarget {
  postMessage(message: unknown): void;
  close(): void;
}

export interface AudioSessionEnvironment {
  readonly document: AudioSessionDocument;
  readonly location: AudioSessionLocation;
  readonly window: AudioSessionEventTarget;
  readonly createChannel: (name: string) => AudioSessionChannel | undefined;
  readonly createId: () => string;
}

/**
 * Only the foreground AKULA document may reach the speakers. Visibility covers
 * duplicate tabs, while focus covers separate windows.
 */
export function mayOwnAudioSession(
  visibilityState: DocumentVisibilityState,
  hasFocus: boolean,
): boolean {
  return visibilityState === "visible" && hasFocus;
}

/**
 * Local development and preview must share one origin so every instance can
 * participate in the same audio lease. Public builds are not port-restricted.
 */
export function mayUseAudioAtLocation(location: AudioSessionLocation): boolean {
  const localHostname =
    location.hostname === "127.0.0.1" ||
    location.hostname === "localhost" ||
    location.hostname === "0.0.0.0" ||
    location.hostname === "::1" ||
    location.hostname === "[::1]";
  if (!localHostname || !["http:", "https:"].includes(location.protocol)) {
    return true;
  }
  return location.port === CANONICAL_LOCAL_AUDIO_PORT;
}

export class AudioSessionCoordinator {
  private readonly ownerId: string;
  private readonly channel: AudioSessionChannel | undefined;
  private active = false;
  private disposed = false;

  public constructor(
    private readonly output: AudioSessionOutput,
    private readonly environment: AudioSessionEnvironment = createBrowserEnvironment(),
  ) {
    this.ownerId = environment.createId();
    this.channel = environment.createChannel(AUDIO_SESSION_CHANNEL_NAME);
    environment.document.addEventListener(
      "visibilitychange",
      this.refreshOwnership,
    );
    environment.window.addEventListener("focus", this.refreshOwnership);
    environment.window.addEventListener("blur", this.relinquishOwnership);
    environment.window.addEventListener("pagehide", this.relinquishOwnership);
    this.channel?.addEventListener("message", this.handleChannelMessage);
    this.refreshOwnership();
  }

  public resumeFromUserGesture(): Promise<void> {
    if (this.disposed || !this.canOwnAudio()) {
      this.setActive(false);
      return Promise.resolve();
    }
    this.claimOwnership();
    return this.output.resume();
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.setActive(false);
    this.environment.document.removeEventListener(
      "visibilitychange",
      this.refreshOwnership,
    );
    this.environment.window.removeEventListener("focus", this.refreshOwnership);
    this.environment.window.removeEventListener(
      "blur",
      this.relinquishOwnership,
    );
    this.environment.window.removeEventListener(
      "pagehide",
      this.relinquishOwnership,
    );
    this.channel?.removeEventListener("message", this.handleChannelMessage);
    this.channel?.close();
  }

  private readonly refreshOwnership = (): void => {
    if (this.disposed) {
      return;
    }
    if (this.canOwnAudio()) {
      this.claimOwnership();
    } else {
      this.setActive(false);
    }
  };

  private readonly relinquishOwnership = (): void => {
    this.setActive(false);
  };

  private readonly handleChannelMessage = (event: Event): void => {
    const message = (event as MessageEvent<unknown>).data;
    if (isAudioSessionClaim(message) && message.ownerId !== this.ownerId) {
      this.setActive(false);
    }
  };

  private canOwnAudio(): boolean {
    return (
      mayUseAudioAtLocation(this.environment.location) &&
      mayOwnAudioSession(
        this.environment.document.visibilityState,
        this.environment.document.hasFocus(),
      )
    );
  }

  private claimOwnership(): void {
    this.setActive(true);
    const claim: AudioSessionClaim = {
      type: "claim",
      ownerId: this.ownerId,
    };
    this.channel?.postMessage(claim);
  }

  private setActive(active: boolean): void {
    if (this.active === active) {
      return;
    }
    this.active = active;
    this.output.setSessionActive(active);
  }
}

function isAudioSessionClaim(value: unknown): value is AudioSessionClaim {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AudioSessionClaim>;
  return candidate.type === "claim" && typeof candidate.ownerId === "string";
}

function createBrowserEnvironment(): AudioSessionEnvironment {
  return {
    document: {
      get visibilityState(): DocumentVisibilityState {
        return document.visibilityState;
      },
      hasFocus: () => document.hasFocus(),
      addEventListener: (type, listener) =>
        document.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        document.removeEventListener(type, listener),
    },
    location: {
      protocol: globalThis.location.protocol,
      hostname: globalThis.location.hostname,
      port: globalThis.location.port,
    },
    window: {
      addEventListener: (type, listener) =>
        globalThis.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        globalThis.removeEventListener(type, listener),
    },
    createChannel: (name) => {
      if (typeof BroadcastChannel === "undefined") {
        return undefined;
      }
      const channel = new BroadcastChannel(name);
      return {
        addEventListener: (type, listener) =>
          channel.addEventListener(type, listener),
        removeEventListener: (type, listener) =>
          channel.removeEventListener(type, listener),
        postMessage: (message) => channel.postMessage(message),
        close: () => channel.close(),
      };
    },
    createId: () =>
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
  };
}
