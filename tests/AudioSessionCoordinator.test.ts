import { describe, expect, it, vi } from "vitest";
import {
  AudioSessionCoordinator,
  mayOwnAudioSession,
  mayUseAudioAtLocation,
  type AudioSessionChannel,
  type AudioSessionDocument,
  type AudioSessionEnvironment,
  type AudioSessionEventTarget,
  type AudioSessionOutput,
} from "../src/game/AudioSessionCoordinator";

class FakeEventTarget implements AudioSessionEventTarget {
  private readonly listeners = new Map<string, Set<EventListener>>();

  public addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  public removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  public dispatch(type: string, event: Event = new Event(type)): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeDocument extends FakeEventTarget implements AudioSessionDocument {
  public visibilityState: DocumentVisibilityState = "visible";
  public focused = true;

  public hasFocus(): boolean {
    return this.focused;
  }
}

class FakeChannel extends FakeEventTarget implements AudioSessionChannel {
  public readonly posts: unknown[] = [];
  public closed = false;

  public postMessage(message: unknown): void {
    this.posts.push(message);
  }

  public receive(message: unknown): void {
    this.dispatch("message", new MessageEvent("message", { data: message }));
  }

  public close(): void {
    this.closed = true;
  }
}

function createHarness(
  focused = true,
  port = "4173",
): {
  readonly coordinator: AudioSessionCoordinator;
  readonly document: FakeDocument;
  readonly window: FakeEventTarget;
  readonly channel: FakeChannel;
  readonly activeStates: boolean[];
  readonly resume: ReturnType<typeof vi.fn>;
} {
  const document = new FakeDocument();
  document.focused = focused;
  const window = new FakeEventTarget();
  const channel = new FakeChannel();
  const activeStates: boolean[] = [];
  const resume = vi.fn(() => Promise.resolve());
  const output: AudioSessionOutput = {
    setSessionActive: (active) => activeStates.push(active),
    resume,
  };
  const environment: AudioSessionEnvironment = {
    document,
    location: {
      protocol: "http:",
      hostname: "127.0.0.1",
      port,
    },
    window,
    createChannel: () => channel,
    createId: () => "local-instance",
  };
  const coordinator = new AudioSessionCoordinator(output, environment);
  return {
    coordinator,
    document,
    window,
    channel,
    activeStates,
    resume,
  };
}

describe("AKULA audio-session ownership", () => {
  it("requires both a visible document and foreground focus", () => {
    expect(mayOwnAudioSession("visible", true)).toBe(true);
    expect(mayOwnAudioSession("visible", false)).toBe(false);
    expect(mayOwnAudioSession("hidden", true)).toBe(false);
  });

  it("reserves local audio for the canonical 4173 origin", async () => {
    expect(
      mayUseAudioAtLocation({
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "4173",
      }),
    ).toBe(true);
    expect(
      mayUseAudioAtLocation({
        protocol: "https:",
        hostname: "akula.example",
        port: "",
      }),
    ).toBe(true);

    const alternatePort = createHarness(true, "5173");
    await alternatePort.coordinator.resumeFromUserGesture();

    expect(alternatePort.activeStates).toEqual([]);
    expect(alternatePort.resume).not.toHaveBeenCalled();
  });

  it("mutes immediately on blur and reclaims on focus", () => {
    const harness = createHarness();

    expect(harness.activeStates).toEqual([true]);
    expect(harness.channel.posts).toHaveLength(1);

    harness.document.focused = false;
    harness.window.dispatch("blur");
    expect(harness.activeStates).toEqual([true, false]);

    harness.document.focused = true;
    harness.window.dispatch("focus");
    expect(harness.activeStates).toEqual([true, false, true]);
  });

  it("yields when another same-origin AKULA instance claims audio", () => {
    const harness = createHarness();

    harness.channel.receive({ type: "claim", ownerId: "other-instance" });

    expect(harness.activeStates).toEqual([true, false]);
  });

  it("only resumes audio from a foreground user gesture", async () => {
    const harness = createHarness(false);

    await harness.coordinator.resumeFromUserGesture();
    expect(harness.resume).not.toHaveBeenCalled();

    harness.document.focused = true;
    await harness.coordinator.resumeFromUserGesture();
    expect(harness.activeStates).toEqual([true]);
    expect(harness.resume).toHaveBeenCalledOnce();
  });

  it("relinquishes audio and closes its channel when disposed", () => {
    const harness = createHarness();

    harness.coordinator.dispose();

    expect(harness.activeStates).toEqual([true, false]);
    expect(harness.channel.closed).toBe(true);
  });
});
