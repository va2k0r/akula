import type { ContactTrackSnapshot } from "./ContactTracker";
import type { Vec2 } from "./NavalContactCatalog";
import {
  projectHypothesisPosition,
  type BearingObservation,
  type TmaSolution,
} from "./TmaSolver";
import {
  torpedoTrajectoryHeading,
  type TorpedoRunToEnablePlan,
  type TorpedoTargetPrediction,
} from "./TorpedoFireControl";
import { MAP_HALF_LENGTH, MAP_HALF_WIDTH } from "./WorldGeometry";

export const STRATEGIC_PLOT_UPDATE_HZ = 4;
const UPDATE_INTERVAL_SECONDS = 1 / STRATEGIC_PLOT_UPDATE_HZ;
const TMA_SETTLED_SAMPLE_INTERVAL_SECONDS = 1.25;
const TMA_MARKER_SAMPLE_INTERVAL_SECONDS = 0.34;
const TMA_MARKER_MOTION_HOLD_SECONDS = 0.65;
const TMA_SETTLED_RESPONSE_SECONDS = 1.8;
const TMA_MARKER_RESPONSE_SECONDS = 0.48;
const TORPEDO_MARKER_MOTION_EPSILON_METERS = 0.05;
const MAXIMUM_PIXEL_RATIO = 1.5;
const MINIMUM_CAMERA_HALF_SPAN_METERS = 220;
const MINIMUM_HALF_SPAN_METERS = 5_000;
const MAXIMUM_HALF_SPAN_METERS = 85_000;
const RANGE_RING_METERS = [500, 1_000, 5_000, 10_000, 20_000, 50_000];
const MAXIMUM_VISIBLE_BEARINGS = 9;
const TRACK_VECTOR_SECONDS = 180;

export interface StrategicPlotFrame {
  readonly ownship: Readonly<{
    position: Vec2;
    headingRad: number;
  }>;
  readonly tracks: readonly ContactTrackSnapshot[];
  readonly timeSeconds: number;
  /** Fixed-camera field of view. Omit to auto-frame a standalone plot. */
  readonly viewHalfSpanMeters?: number;
  /** Clockwise map-camera yaw from north. Omit for a north-up plot. */
  readonly viewYawRad?: number;
  /** Player-authored weapon run; never derived from hidden contact truth. */
  readonly torpedoPlan?: TorpedoRunToEnablePlan;
  /** Run-to-enable points already set for the next simultaneous salvo. */
  readonly torpedoPlans?: readonly TorpedoRunToEnablePlan[];
  /** Constant-course TMA lead at the torpedo's run-to-enable arrival time. */
  readonly torpedoTargetPrediction?: TorpedoTargetPrediction;
  /** Temporary exact contact truth shown while the prototype is in development. */
  readonly developmentEnemy?: Readonly<{
    position: Vec2;
    headingRad: number;
    speedKt: number;
  }>;
}

export interface StrategicPlotPoint {
  readonly x: number;
  readonly y: number;
}

export interface StrategicEnemyMarker {
  readonly point: StrategicPlotPoint;
  readonly directionRad: number;
  readonly offPlot: boolean;
}

export interface StrategicTrackIntersection {
  readonly observation: BearingObservation;
  readonly position: Vec2;
  readonly distanceAlongTrackMeters: number;
  readonly distanceAlongBearingMeters: number;
}

export interface StrategicTrackHistory {
  readonly currentPosition: Vec2;
  readonly courseRad: number;
  readonly speedMps: number;
  /** 0..1 visual certainty derived only from hypothesis convergence. */
  readonly confidence: number;
  readonly intersections: readonly StrategicTrackIntersection[];
}

interface TrackHitRegion {
  readonly trackId: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

/** Full strategic-view plot, including a temporary development-only truth marker. */
export class StrategicPlot {
  private readonly context: CanvasRenderingContext2D;
  private readonly abortController = new AbortController();
  private readonly hitRegions: TrackHitRegion[] = [];
  /** Keeps solver noise out of the fast camera and torpedo-marker redraw path. */
  private readonly stabilizedTrackHistories = new Map<
    string,
    StrategicTrackHistory
  >();
  private nextRenderAt = 0;
  private nextTmaSampleAt = Number.NEGATIVE_INFINITY;
  private lastTmaSampleAt = Number.NEGATIVE_INFINITY;
  private markerMotionBoostUntil = Number.NEGATIVE_INFINITY;
  private lastFrame: StrategicPlotFrame | undefined;
  private pixelRatio = 1;

  public constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onSelectTrack: (trackId: string) => void,
  ) {
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) {
      throw new Error("The strategic plot requires a 2D canvas context.");
    }
    this.context = context;
    canvas.addEventListener(
      "pointerup",
      (event) => this.selectAtPointer(event),
      { signal: this.abortController.signal },
    );
  }

  public resize(): void {
    const bounds = this.canvas.getBoundingClientRect();
    if (bounds.width < 1 || bounds.height < 1) {
      return;
    }
    this.pixelRatio = Math.min(
      globalThis.devicePixelRatio || 1,
      MAXIMUM_PIXEL_RATIO,
    );
    const width = Math.max(1, Math.round(bounds.width * this.pixelRatio));
    const height = Math.max(1, Math.round(bounds.height * this.pixelRatio));
    if (width === this.canvas.width && height === this.canvas.height) {
      return;
    }
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.lastFrame !== undefined) {
      this.render(this.lastFrame);
    }
  }

  public update(frame: StrategicPlotFrame): void {
    const previousFrame = this.lastFrame;
    if (frame.timeSeconds + 1e-8 < this.lastTmaSampleAt) {
      this.stabilizedTrackHistories.clear();
      this.nextTmaSampleAt = Number.NEGATIVE_INFINITY;
      this.lastTmaSampleAt = Number.NEGATIVE_INFINITY;
      this.markerMotionBoostUntil = Number.NEGATIVE_INFINITY;
    }
    const markerMoved = strategicTorpedoMarkerMoved(previousFrame, frame);
    if (markerMoved) {
      this.markerMotionBoostUntil =
        frame.timeSeconds + TMA_MARKER_MOTION_HOLD_SECONDS;
      this.nextTmaSampleAt = Math.min(
        this.nextTmaSampleAt,
        frame.timeSeconds + TMA_MARKER_SAMPLE_INTERVAL_SECONDS,
      );
    }
    this.lastFrame = frame;
    this.updateStabilizedTma(
      frame,
      frame.timeSeconds <= this.markerMotionBoostUntil,
    );
    if (this.canvas.width < 2 || this.canvas.height < 2) {
      this.resize();
    }
    const viewTransformChanged = strategicViewTransformChanged(
      previousFrame,
      frame,
    );
    if (!viewTransformChanged && frame.timeSeconds + 1e-8 < this.nextRenderAt) {
      return;
    }
    this.nextRenderAt = frame.timeSeconds + UPDATE_INTERVAL_SECONDS;
    this.render(frame);
  }

  public dispose(): void {
    this.abortController.abort();
    this.hitRegions.length = 0;
    this.stabilizedTrackHistories.clear();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }

  private render(frame: StrategicPlotFrame): void {
    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(2, 9, 8, 0.86)";
    context.fillRect(0, 0, width, height);
    this.hitRegions.length = 0;

    const halfSpanMeters = strategicPlotHalfSpanMeters(frame);
    this.drawGrid(frame, halfSpanMeters);
    this.drawRangeRings(frame, halfSpanMeters);
    this.drawLocalThreeDimensionalVolume(frame, halfSpanMeters);
    for (const track of frame.tracks) {
      this.drawBearingHistory(
        frame,
        track,
        halfSpanMeters,
        this.stabilizedTrackHistories.get(track.id),
      );
    }
    for (const track of frame.tracks) {
      this.drawTrack(
        frame,
        track,
        halfSpanMeters,
        this.stabilizedTrackHistories.get(track.id),
      );
    }
    if (frame.developmentEnemy !== undefined) {
      this.drawDevelopmentEnemy(frame, halfSpanMeters);
    }
    for (const [index, plan] of (frame.torpedoPlans ?? []).entries()) {
      this.drawTorpedoPlan(frame, plan, halfSpanMeters, index + 1);
    }
    if (frame.torpedoPlan !== undefined) {
      this.drawTorpedoPlan(
        frame,
        frame.torpedoPlan,
        halfSpanMeters,
        (frame.torpedoPlans?.length ?? 0) + 1,
      );
    }
    this.drawOwnship(frame, halfSpanMeters);
  }

  private updateStabilizedTma(
    frame: StrategicPlotFrame,
    markerMoving: boolean,
  ): void {
    const eligibleTracks = frame.tracks.filter(
      (track) =>
        track.solution !== undefined && track.identification !== undefined,
    );
    const eligibleTrackIds = new Set(eligibleTracks.map(({ id }) => id));
    for (const trackId of this.stabilizedTrackHistories.keys()) {
      if (!eligibleTrackIds.has(trackId)) {
        this.stabilizedTrackHistories.delete(trackId);
      }
    }
    const missingTrack = eligibleTracks.some(
      ({ id }) => !this.stabilizedTrackHistories.has(id),
    );
    if (!missingTrack && frame.timeSeconds + 1e-8 < this.nextTmaSampleAt) {
      return;
    }

    const elapsedSeconds = Number.isFinite(this.lastTmaSampleAt)
      ? Math.max(0, frame.timeSeconds - this.lastTmaSampleAt)
      : Number.POSITIVE_INFINITY;
    const followAmount = strategicTmaPoseFollowAmount(
      elapsedSeconds,
      markerMoving,
    );
    for (const track of eligibleTracks) {
      const solution = track.solution;
      if (solution === undefined) {
        continue;
      }
      const sampled = strategicTrackHistory(
        solution,
        track.observations,
        frame.timeSeconds,
      );
      if (sampled === undefined) {
        this.stabilizedTrackHistories.delete(track.id);
        continue;
      }
      const previous = this.stabilizedTrackHistories.get(track.id);
      this.stabilizedTrackHistories.set(
        track.id,
        previous === undefined
          ? sampled
          : stabilizeStrategicTrackHistory(
              previous,
              sampled,
              track.observations,
              followAmount,
            ),
      );
    }
    this.lastTmaSampleAt = frame.timeSeconds;
    this.nextTmaSampleAt =
      frame.timeSeconds + strategicTmaSampleIntervalSeconds(markerMoving);
  }

  private project(
    world: Vec2,
    frame: StrategicPlotFrame,
    halfSpanMeters: number,
  ): StrategicPlotPoint {
    return strategicPlotWorldToCanvas(
      world,
      frame.ownship.position,
      halfSpanMeters,
      this.canvas.width,
      this.canvas.height,
      frame.viewYawRad,
    );
  }

  private drawRangeRings(
    frame: StrategicPlotFrame,
    halfSpanMeters: number,
  ): void {
    const context = this.context;
    const center = this.project(frame.ownship.position, frame, halfSpanMeters);
    const pixelsPerMeter =
      Math.min(this.canvas.width, this.canvas.height) / (halfSpanMeters * 2);
    context.save();
    context.lineWidth = this.pixelRatio * 0.7;
    context.strokeStyle = "rgba(180, 210, 175, 0.12)";
    context.fillStyle = "rgba(184, 211, 179, 0.42)";
    context.font = `${Math.round(this.pixelRatio * 8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.setLineDash([this.pixelRatio * 3, this.pixelRatio * 6]);
    for (const rangeMeters of RANGE_RING_METERS) {
      const radius = rangeMeters * pixelsPerMeter;
      if (
        radius < this.pixelRatio * 30 ||
        radius > Math.min(this.canvas.width, this.canvas.height) * 0.48
      ) {
        continue;
      }
      context.beginPath();
      context.arc(center.x, center.y, radius, 0, Math.PI * 2);
      context.stroke();
      context.fillText(
        formatDistance(rangeMeters),
        center.x + this.pixelRatio * 5,
        center.y - radius - this.pixelRatio * 5,
      );
    }
    context.restore();
  }

  private drawLocalThreeDimensionalVolume(
    frame: StrategicPlotFrame,
    halfSpanMeters: number,
  ): void {
    const corners = [
      { x: -MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
      { x: MAP_HALF_WIDTH, z: -MAP_HALF_LENGTH },
      { x: MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
      { x: -MAP_HALF_WIDTH, z: MAP_HALF_LENGTH },
    ].map((corner) => this.project(corner, frame, halfSpanMeters));
    const left = Math.min(...corners.map(({ x }) => x));
    const top = Math.min(...corners.map(({ y }) => y));
    const right = Math.max(...corners.map(({ x }) => x));
    const bottom = Math.max(...corners.map(({ y }) => y));
    const width = right - left;
    const height = bottom - top;
    if (
      left > this.canvas.width ||
      top > this.canvas.height ||
      left + width < 0 ||
      top + height < 0
    ) {
      return;
    }

    const context = this.context;
    context.save();
    context.fillStyle = "rgba(199, 163, 98, 0.035)";
    context.strokeStyle = "rgba(207, 179, 119, 0.46)";
    context.lineWidth = this.pixelRatio;
    context.setLineDash([this.pixelRatio * 4, this.pixelRatio * 4]);
    context.beginPath();
    context.moveTo(corners[0]?.x ?? 0, corners[0]?.y ?? 0);
    for (const corner of corners.slice(1)) {
      context.lineTo(corner.x, corner.y);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "rgba(214, 188, 132, 0.72)";
    context.font = `${Math.round(this.pixelRatio * 8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(
      width >= this.pixelRatio * 90
        ? `LOCAL 3D · ${formatLocalChartDimensions()}`
        : "LOCAL 3D",
      Math.max(this.pixelRatio * 8, left + this.pixelRatio * 5),
      Math.max(this.pixelRatio * 12, top - this.pixelRatio * 6),
    );
    context.restore();
  }

  private drawGrid(frame: StrategicPlotFrame, halfSpanMeters: number): void {
    const context = this.context;
    const center = frame.ownship.position;
    const gridStep = niceGridStep(halfSpanMeters);
    const minimumX = center.x - halfSpanMeters;
    const maximumX = center.x + halfSpanMeters;
    const minimumZ = center.z - halfSpanMeters;
    const maximumZ = center.z + halfSpanMeters;
    context.save();
    context.lineWidth = this.pixelRatio * 0.7;
    context.strokeStyle = "rgba(172, 203, 168, 0.09)";
    for (
      let x = Math.ceil(minimumX / gridStep) * gridStep;
      x <= maximumX;
      x += gridStep
    ) {
      const start = this.project({ x, z: minimumZ }, frame, halfSpanMeters);
      const end = this.project({ x, z: maximumZ }, frame, halfSpanMeters);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    for (
      let z = Math.ceil(minimumZ / gridStep) * gridStep;
      z <= maximumZ;
      z += gridStep
    ) {
      const start = this.project({ x: minimumX, z }, frame, halfSpanMeters);
      const end = this.project({ x: maximumX, z }, frame, halfSpanMeters);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
    }
    context.restore();
  }

  private drawBearingHistory(
    frame: StrategicPlotFrame,
    track: ContactTrackSnapshot,
    halfSpanMeters: number,
    history: StrategicTrackHistory | undefined,
  ): void {
    const observations = strategicBearingHistorySamples(
      track.observations,
      MAXIMUM_VISIBLE_BEARINGS,
    );
    const currentEstimate = history?.currentPosition;
    const estimatedRange =
      currentEstimate === undefined
        ? undefined
        : Math.hypot(
            currentEstimate.x - frame.ownship.position.x,
            currentEstimate.z - frame.ownship.position.z,
          );
    const rayLength =
      estimatedRange === undefined
        ? halfSpanMeters * 1.15
        : clamp(
            estimatedRange * 1.18,
            halfSpanMeters * 0.3,
            halfSpanMeters * 1.15,
          );
    const context = this.context;
    for (const [index, observation] of observations.entries()) {
      const recencyAmount =
        observations.length <= 1 ? 1 : index / (observations.length - 1);
      const opacity = strategicBearingLineOpacity(
        recencyAmount,
        observation.signalQuality,
        track.active,
      );
      const start = this.project(
        observation.ownshipPosition,
        frame,
        halfSpanMeters,
      );
      const intersection = history?.intersections.find(
        (candidate) => candidate.observation === observation,
      );
      const endWorld =
        intersection?.position ??
        ({
          x:
            observation.ownshipPosition.x +
            Math.sin(observation.bearingRad) * rayLength,
          z:
            observation.ownshipPosition.z -
            Math.cos(observation.bearingRad) * rayLength,
        } satisfies Vec2);
      const end = this.project(endWorld, frame, halfSpanMeters);
      context.save();
      context.strokeStyle = `rgba(190, 227, 187, ${opacity.toFixed(3)})`;
      context.lineWidth = Math.max(0.5, this.pixelRatio * 0.42);
      context.beginPath();
      context.moveTo(start.x, start.y);
      context.lineTo(end.x, end.y);
      context.stroke();
      context.restore();
    }
  }

  private drawTrack(
    frame: StrategicPlotFrame,
    track: ContactTrackSnapshot,
    halfSpanMeters: number,
    history: StrategicTrackHistory | undefined,
  ): void {
    if (
      track.solution === undefined ||
      track.identification === undefined ||
      history === undefined
    ) {
      return;
    }
    this.drawEstimatedTrack(frame, track, history, halfSpanMeters);
    const point = this.project(history.currentPosition, frame, halfSpanMeters);
    this.hitRegions.push({
      trackId: track.id,
      x: point.x,
      y: point.y,
      radius: this.pixelRatio * 22,
    });
  }

  private drawEstimatedTrack(
    frame: StrategicPlotFrame,
    track: ContactTrackSnapshot,
    history: StrategicTrackHistory,
    halfSpanMeters: number,
  ): void {
    const context = this.context;
    const targetPrediction =
      frame.torpedoTargetPrediction?.trackId === track.id
        ? frame.torpedoTargetPrediction
        : undefined;
    const statusAmount =
      track.status === "LOST" ? 0.34 : track.status === "WEAK" ? 0.66 : 1;
    const activeAmount =
      (targetPrediction !== undefined || track.active ? 1 : 0.38) *
      statusAmount;
    const trackOpacity =
      strategicTmaArrowOpacity(history.confidence) *
      activeAmount *
      (track.possibleManeuver ? 0.56 : 1);
    const direction = {
      x: Math.sin(history.courseRad),
      z: -Math.cos(history.courseRad),
    };
    const minimumIntersectionDistance = Math.min(
      0,
      ...history.intersections.map(
        ({ distanceAlongTrackMeters }) => distanceAlongTrackMeters,
      ),
    );
    const maximumIntersectionDistance = Math.max(
      0,
      ...history.intersections.map(
        ({ distanceAlongTrackMeters }) => distanceAlongTrackMeters,
      ),
    );
    const lineStartDistance =
      minimumIntersectionDistance - Math.max(600, halfSpanMeters * 0.1);
    const forwardProjectionMeters =
      targetPrediction === undefined
        ? Math.max(
            1_000,
            history.speedMps * TRACK_VECTOR_SECONDS,
            halfSpanMeters * 0.16,
          )
        : Math.max(0, history.speedMps * targetPrediction.travelTimeSeconds);
    const lineEndDistance =
      targetPrediction === undefined
        ? Math.max(
            maximumIntersectionDistance + Math.max(500, halfSpanMeters * 0.04),
            forwardProjectionMeters,
          )
        : forwardProjectionMeters;
    const startWorld = pointAlongTrack(
      history.currentPosition,
      direction,
      lineStartDistance,
    );
    const endWorld = pointAlongTrack(
      history.currentPosition,
      direction,
      lineEndDistance,
    );
    const startPoint = this.project(startWorld, frame, halfSpanMeters);
    const endPoint = this.project(endWorld, frame, halfSpanMeters);
    context.save();
    context.strokeStyle = `rgba(126, 235, 197, ${trackOpacity.toFixed(3)})`;
    context.lineWidth = Math.max(0.55, this.pixelRatio * 0.62);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([
      Math.max(0.45, this.pixelRatio * 0.45),
      this.pixelRatio * 5.2,
    ]);
    context.beginPath();
    context.moveTo(startPoint.x, startPoint.y);
    context.lineTo(endPoint.x, endPoint.y);
    context.stroke();

    const displayCourse = strategicDisplayHeading(
      history.courseRad,
      frame.viewYawRad,
    );
    context.translate(endPoint.x, endPoint.y);
    context.rotate(displayCourse);
    context.beginPath();
    context.moveTo(-this.pixelRatio * 5.5, this.pixelRatio * 8);
    context.lineTo(0, 0);
    context.lineTo(this.pixelRatio * 5.5, this.pixelRatio * 8);
    context.stroke();
    context.restore();
  }

  private drawDevelopmentEnemy(
    frame: StrategicPlotFrame,
    halfSpanMeters: number,
  ): void {
    const enemy = frame.developmentEnemy;
    if (enemy === undefined) {
      return;
    }
    const scale = this.pixelRatio;
    const marker = strategicDevelopmentEnemyMarker(
      frame,
      enemy.position,
      halfSpanMeters,
      this.canvas.width,
      this.canvas.height,
      scale * 30,
    );
    const context = this.context;
    const rangeMeters = Math.hypot(
      enemy.position.x - frame.ownship.position.x,
      enemy.position.z - frame.ownship.position.z,
    );
    const activeTrack = frame.tracks.find(({ active }) => active);
    const history =
      activeTrack?.solution === undefined
        ? undefined
        : strategicTrackHistory(
            activeTrack.solution,
            strategicCurrentMotionObservations(activeTrack),
            frame.timeSeconds,
          );
    const estimatedPoint = history?.currentPosition;
    const estimatedCanvasPoint =
      estimatedPoint === undefined
        ? undefined
        : this.project(estimatedPoint, frame, halfSpanMeters);
    const nearEstimatedTrack =
      estimatedCanvasPoint !== undefined &&
      Math.hypot(
        estimatedCanvasPoint.x - marker.point.x,
        estimatedCanvasPoint.y - marker.point.y,
      ) <
        scale * 72;

    if (!marker.offPlot) {
      const courseDistanceMeters = enemy.speedKt * 0.514_444 * 600;
      const future = {
        x: enemy.position.x + Math.sin(enemy.headingRad) * courseDistanceMeters,
        z: enemy.position.z - Math.cos(enemy.headingRad) * courseDistanceMeters,
      };
      const futurePoint = this.project(future, frame, halfSpanMeters);
      context.save();
      context.strokeStyle = "rgba(255, 111, 67, 0.72)";
      context.lineWidth = scale * 1.2;
      context.setLineDash([scale * 5, scale * 3]);
      context.beginPath();
      context.moveTo(marker.point.x, marker.point.y);
      context.lineTo(futurePoint.x, futurePoint.y);
      context.stroke();
      context.restore();
    }

    context.save();
    context.translate(marker.point.x, marker.point.y);
    context.rotate(
      marker.offPlot
        ? marker.directionRad
        : strategicDisplayHeading(enemy.headingRad, frame.viewYawRad),
    );
    context.shadowColor = "rgba(255, 70, 38, 0.92)";
    context.shadowBlur = scale * 12;
    context.fillStyle = "rgba(255, 100, 57, 0.96)";
    context.strokeStyle = "rgba(255, 226, 204, 0.98)";
    context.lineWidth = scale * 1.25;
    context.beginPath();
    if (marker.offPlot) {
      context.moveTo(0, -scale * 11);
      context.lineTo(scale * 7, scale * 7);
      context.lineTo(0, scale * 3.5);
      context.lineTo(-scale * 7, scale * 7);
    } else {
      context.moveTo(0, -scale * 8);
      context.lineTo(scale * 8, 0);
      context.lineTo(0, scale * 8);
      context.lineTo(-scale * 8, 0);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();

    const labelOnLeft =
      nearEstimatedTrack || marker.point.x > this.canvas.width * 0.62;
    const labelX = marker.point.x + (labelOnLeft ? -scale * 15 : scale * 15);
    const labelY = clamp(
      marker.point.y - scale * 8,
      scale * 18,
      this.canvas.height - scale * 28,
    );
    context.save();
    context.textAlign = labelOnLeft ? "right" : "left";
    context.fillStyle = "rgba(255, 177, 127, 0.98)";
    context.font = `700 ${Math.round(scale * 10)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(
      marker.offPlot ? "ENEMY · DEV TRUTH · OFF MAP" : "ENEMY · DEV TRUTH",
      labelX,
      labelY,
    );
    context.fillStyle = "rgba(255, 151, 103, 0.88)";
    context.font = `${Math.round(scale * 8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(
      `${formatDistance(rangeMeters)} · ${formatHeading(enemy.headingRad)} · ${enemy.speedKt.toFixed(1)} KT`,
      labelX,
      labelY + scale * 12,
    );
    context.restore();
  }

  private drawOwnship(frame: StrategicPlotFrame, halfSpanMeters: number): void {
    const point = this.project(frame.ownship.position, frame, halfSpanMeters);
    const context = this.context;
    const scale = this.pixelRatio;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(
      strategicDisplayHeading(frame.ownship.headingRad, frame.viewYawRad),
    );
    context.strokeStyle = "rgba(235, 247, 229, 0.98)";
    context.lineWidth = scale * 1.3;
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, -scale * 34);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, scale * 4.6, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.arc(0, 0, scale * 7.6, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  private drawTorpedoPlan(
    frame: StrategicPlotFrame,
    plan: TorpedoRunToEnablePlan,
    halfSpanMeters: number,
    salvoIndex: number,
  ): void {
    const context = this.context;
    const scale = this.pixelRatio;
    const originWorld = frame.ownship.position;
    const headingRad = torpedoTrajectoryHeading(
      originWorld,
      plan.enablePoint,
      frame.ownship.headingRad,
    );
    const searchLengthMeters = clamp(halfSpanMeters * 0.38, 800, 12_000);
    const startHalfWidthMeters = Math.max(35, searchLengthMeters * 0.018);
    const endHalfWidthMeters = searchLengthMeters * 0.3;
    const forward = {
      x: Math.sin(headingRad),
      z: -Math.cos(headingRad),
    };
    const right = { x: Math.cos(headingRad), z: Math.sin(headingRad) };
    const searchEnd = {
      x: plan.enablePoint.x + forward.x * searchLengthMeters,
      z: plan.enablePoint.z + forward.z * searchLengthMeters,
    };
    const startLeft = this.project(
      {
        x: plan.enablePoint.x - right.x * startHalfWidthMeters,
        z: plan.enablePoint.z - right.z * startHalfWidthMeters,
      },
      frame,
      halfSpanMeters,
    );
    const startRight = this.project(
      {
        x: plan.enablePoint.x + right.x * startHalfWidthMeters,
        z: plan.enablePoint.z + right.z * startHalfWidthMeters,
      },
      frame,
      halfSpanMeters,
    );
    const endLeft = this.project(
      {
        x: searchEnd.x - right.x * endHalfWidthMeters,
        z: searchEnd.z - right.z * endHalfWidthMeters,
      },
      frame,
      halfSpanMeters,
    );
    const endRight = this.project(
      {
        x: searchEnd.x + right.x * endHalfWidthMeters,
        z: searchEnd.z + right.z * endHalfWidthMeters,
      },
      frame,
      halfSpanMeters,
    );
    const origin = this.project(originWorld, frame, halfSpanMeters);
    const enable = this.project(plan.enablePoint, frame, halfSpanMeters);
    const end = this.project(searchEnd, frame, halfSpanMeters);

    context.save();
    const searchGradient = context.createLinearGradient(
      enable.x,
      enable.y,
      end.x,
      end.y,
    );
    searchGradient.addColorStop(0, "rgba(226, 39, 48, 0.34)");
    searchGradient.addColorStop(0.24, "rgba(226, 39, 48, 0.2)");
    searchGradient.addColorStop(0.66, "rgba(226, 39, 48, 0.07)");
    searchGradient.addColorStop(1, "rgba(226, 39, 48, 0)");
    context.fillStyle = searchGradient;
    context.beginPath();
    context.moveTo(startLeft.x, startLeft.y);
    context.lineTo(endLeft.x, endLeft.y);
    context.lineTo(endRight.x, endRight.y);
    context.lineTo(startRight.x, startRight.y);
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(242, 63, 69, 0.9)";
    context.lineWidth = scale * 1.15;
    context.setLineDash([scale * 7, scale * 6]);
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(enable.x, enable.y);
    context.stroke();
    context.setLineDash([]);

    context.translate(enable.x, enable.y);
    context.rotate(
      strategicDisplayHeading(headingRad, frame.viewYawRad) + Math.PI / 4,
    );
    context.shadowColor = "rgba(255, 35, 45, 0.9)";
    context.shadowBlur = scale * (plan.status === "placing" ? 14 : 8);
    context.fillStyle = "rgba(12, 18, 16, 0.94)";
    context.strokeStyle = "rgba(255, 82, 88, 0.98)";
    context.lineWidth = scale * 1.5;
    context.beginPath();
    context.rect(-scale * 7, -scale * 7, scale * 14, scale * 14);
    context.fill();
    context.stroke();
    context.rotate(-Math.PI / 4);
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(0, -scale * 15);
    context.stroke();
    context.restore();

    if (plan.status === "placing") {
      const pulse = 0.5 + Math.sin(frame.timeSeconds * 8) * 0.5;
      context.save();
      context.strokeStyle = `rgba(255, 90, 96, ${(0.28 + pulse * 0.34).toFixed(3)})`;
      context.lineWidth = scale;
      context.beginPath();
      context.arc(enable.x, enable.y, scale * (12 + pulse * 6), 0, Math.PI * 2);
      context.stroke();
      context.restore();
    }

    const rangeMeters = Math.hypot(
      plan.enablePoint.x - originWorld.x,
      plan.enablePoint.z - originWorld.z,
    );
    const labelOnLeft = enable.x > this.canvas.width * 0.72;
    const labelX = enable.x + (labelOnLeft ? -scale * 14 : scale * 14);
    const labelStagger = ((salvoIndex - 1) % 4) * scale * 15;
    const labelY = clamp(
      enable.y - scale * 12 + labelStagger,
      scale * 18,
      this.canvas.height - scale * 28,
    );
    context.save();
    context.textAlign = labelOnLeft ? "right" : "left";
    context.fillStyle = "rgba(255, 131, 132, 0.98)";
    context.font = `700 ${Math.round(scale * 9)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(
      plan.status === "placing"
        ? `T-${salvoIndex.toString().padStart(2, "0")} · POSITIONING`
        : `T-${salvoIndex.toString().padStart(2, "0")} · SET`,
      labelX,
      labelY,
    );
    context.fillStyle = "rgba(244, 109, 112, 0.78)";
    context.font = `${Math.round(scale * 8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillText(formatDistance(rangeMeters), labelX, labelY + scale * 12);
    context.restore();
  }

  private selectAtPointer(event: PointerEvent): void {
    const bounds = this.canvas.getBoundingClientRect();
    const x =
      (event.clientX - bounds.left) * (this.canvas.width / bounds.width);
    const y =
      (event.clientY - bounds.top) * (this.canvas.height / bounds.height);
    const hit = [...this.hitRegions]
      .map((region) => ({
        region,
        distance: Math.hypot(region.x - x, region.y - y),
      }))
      .filter(({ region, distance }) => distance <= region.radius)
      .sort((left, right) => left.distance - right.distance)[0];
    if (hit !== undefined) {
      this.onSelectTrack(hit.region.trackId);
    }
  }
}

export function strategicPlotHalfSpanMeters(frame: StrategicPlotFrame): number {
  if (
    frame.viewHalfSpanMeters !== undefined &&
    Number.isFinite(frame.viewHalfSpanMeters)
  ) {
    return clamp(
      frame.viewHalfSpanMeters,
      MINIMUM_CAMERA_HALF_SPAN_METERS,
      MAXIMUM_HALF_SPAN_METERS,
    );
  }
  const activeTrack =
    frame.tracks.find(({ active }) => active) ?? frame.tracks[0];
  const solution = activeTrack?.solution;
  if (solution === undefined || solution.hypotheses.length === 0) {
    return 30_000;
  }
  const maximumWeight = solution.hypotheses.reduce(
    (maximum, hypothesis) => Math.max(maximum, hypothesis.weight),
    0,
  );
  const relevantDistances = solution.hypotheses
    .filter(
      (hypothesis) =>
        maximumWeight <= 0 || hypothesis.weight >= maximumWeight * 0.01,
    )
    .map((hypothesis) => {
      const position = projectHypothesisPosition(
        hypothesis,
        solution.solvedAtSeconds,
        frame.timeSeconds,
      );
      return Math.hypot(
        position.x - frame.ownship.position.x,
        position.z - frame.ownship.position.z,
      );
    });
  const maximumDistance = Math.max(
    MINIMUM_HALF_SPAN_METERS,
    ...relevantDistances,
  );
  return clamp(
    maximumDistance * 1.14,
    MINIMUM_HALF_SPAN_METERS,
    MAXIMUM_HALF_SPAN_METERS,
  );
}

export function strategicRecommendedViewSpanMeters(
  frame: StrategicPlotFrame,
): number | undefined {
  const activeTrack =
    frame.tracks.find(({ active }) => active) ?? frame.tracks[0];
  if (activeTrack === undefined || activeTrack.solution === undefined) {
    return undefined;
  }
  const solution = activeTrack.solution;
  const history = strategicTrackHistory(
    solution,
    strategicCurrentMotionObservations(activeTrack),
    frame.timeSeconds,
  );
  if (history === undefined) {
    return undefined;
  }
  const rangeMeters = Math.hypot(
    history.currentPosition.x - frame.ownship.position.x,
    history.currentPosition.z - frame.ownship.position.z,
  );
  return clamp(
    (rangeMeters +
      (solution.weightedSpreadMeters +
        strategicTrackUncertaintyGrowth(activeTrack, frame.timeSeconds)) *
        0.65) *
      2.2,
    12_000,
    40_000,
  );
}

export function strategicBearingHistorySamples(
  observations: readonly BearingObservation[],
  maximumSamples = MAXIMUM_VISIBLE_BEARINGS,
): readonly BearingObservation[] {
  const count = Math.max(0, Math.floor(maximumSamples));
  if (count === 0 || observations.length === 0) {
    return [];
  }
  if (observations.length <= count) {
    return [...observations];
  }
  if (count === 1) {
    const latest = observations.at(-1);
    return latest === undefined ? [] : [latest];
  }
  const selected: BearingObservation[] = [];
  const selectedIndices = new Set<number>();
  for (let sample = 0; sample < count; sample += 1) {
    const index = Math.round(
      (sample / (count - 1)) * (observations.length - 1),
    );
    if (selectedIndices.has(index)) {
      continue;
    }
    const observation = observations[index];
    if (observation !== undefined) {
      selected.push(observation);
      selectedIndices.add(index);
    }
  }
  return selected;
}

export function strategicBearingLineOpacity(
  recencyAmount: number,
  signalQuality: number,
  active: boolean,
): number {
  const recency = clamp(recencyAmount, 0, 1);
  const quality = clamp(signalQuality, 0, 1);
  return (
    (0.018 + Math.pow(recency, 2.4) * 0.48) *
    (0.38 + quality * 0.62) *
    (active ? 1 : 0.48)
  );
}

export function strategicTmaArrowOpacity(confidence: number): number {
  const highConfidenceAmount = clamp((confidence - 0.82) / 0.13, 0, 1);
  const eased =
    highConfidenceAmount *
    highConfidenceAmount *
    (3 - 2 * highConfidenceAmount);
  return 0.035 + eased * 0.8;
}

export function strategicTmaSampleIntervalSeconds(
  markerMoving: boolean,
): number {
  return markerMoving
    ? TMA_MARKER_SAMPLE_INTERVAL_SECONDS
    : TMA_SETTLED_SAMPLE_INTERVAL_SECONDS;
}

export function strategicTmaPoseFollowAmount(
  elapsedSeconds: number,
  markerMoving: boolean,
): number {
  if (!Number.isFinite(elapsedSeconds)) {
    return 1;
  }
  const responseSeconds = markerMoving
    ? TMA_MARKER_RESPONSE_SECONDS
    : TMA_SETTLED_RESPONSE_SECONDS;
  const boundedElapsedSeconds = Math.min(
    Math.max(0, elapsedSeconds),
    strategicTmaSampleIntervalSeconds(markerMoving),
  );
  return clamp(1 - Math.exp(-boundedElapsedSeconds / responseSeconds), 0, 1);
}

export function strategicTrackHistory(
  solution: TmaSolution,
  observations: readonly BearingObservation[],
  timeSeconds: number,
  maximumSamples = MAXIMUM_VISIBLE_BEARINGS,
): StrategicTrackHistory | undefined {
  if (solution.hypotheses.length === 0) {
    return undefined;
  }
  const normalizedWeights = normalizedHypothesisWeights(solution);
  const currentPositions = solution.hypotheses.map((hypothesis) =>
    projectHypothesisPosition(
      hypothesis,
      solution.solvedAtSeconds,
      timeSeconds,
    ),
  );
  const currentPosition = currentPositions.reduce(
    (sum, position, index) => ({
      x: sum.x + position.x * (normalizedWeights[index] ?? 0),
      z: sum.z + position.z * (normalizedWeights[index] ?? 0),
    }),
    { x: 0, z: 0 },
  );
  const weightedMotion = solution.hypotheses.reduce(
    (sum, hypothesis, index) => {
      const weight = normalizedWeights[index] ?? 0;
      return {
        x:
          sum.x +
          Math.sin(hypothesis.targetCourseRad) *
            hypothesis.targetSpeedMps *
            weight,
        z:
          sum.z -
          Math.cos(hypothesis.targetCourseRad) *
            hypothesis.targetSpeedMps *
            weight,
        speed: sum.speed + hypothesis.targetSpeedMps * weight,
      };
    },
    { x: 0, z: 0, speed: 0 },
  );
  const coherentSpeed = Math.hypot(weightedMotion.x, weightedMotion.z);
  const weightedDirection = solution.hypotheses.reduce(
    (sum, hypothesis, index) => ({
      x:
        sum.x +
        Math.sin(hypothesis.targetCourseRad) * (normalizedWeights[index] ?? 0),
      z:
        sum.z -
        Math.cos(hypothesis.targetCourseRad) * (normalizedWeights[index] ?? 0),
    }),
    { x: 0, z: 0 },
  );
  const fallbackDirectionLength = Math.hypot(
    weightedDirection.x,
    weightedDirection.z,
  );
  const direction =
    coherentSpeed > 1e-6
      ? {
          x: weightedMotion.x / coherentSpeed,
          z: weightedMotion.z / coherentSpeed,
        }
      : fallbackDirectionLength > 1e-6
        ? {
            x: weightedDirection.x / fallbackDirectionLength,
            z: weightedDirection.z / fallbackDirectionLength,
          }
        : { x: 0, z: -1 };
  const courseRad = Math.atan2(direction.x, -direction.z);
  const intersections = strategicBearingHistorySamples(
    observations,
    maximumSamples,
  ).flatMap((observation) => {
    const intersection = strategicBearingTrackIntersection(
      observation,
      currentPosition,
      direction,
    );
    return intersection === undefined ? [] : [intersection];
  });
  return {
    currentPosition,
    courseRad,
    speedMps: weightedMotion.speed,
    confidence: clamp(solution.confidence, 0, 1),
    intersections,
  };
}

function strategicBearingTrackIntersection(
  observation: BearingObservation,
  trackPosition: Vec2,
  trackDirection: Vec2,
): StrategicTrackIntersection | undefined {
  const bearingDirection = {
    x: Math.sin(observation.bearingRad),
    z: -Math.cos(observation.bearingRad),
  };
  const denominator = cross2d(bearingDirection, trackDirection);
  if (Math.abs(denominator) < 1e-5) {
    return undefined;
  }
  const delta = {
    x: trackPosition.x - observation.ownshipPosition.x,
    z: trackPosition.z - observation.ownshipPosition.z,
  };
  const distanceAlongBearingMeters =
    cross2d(delta, trackDirection) / denominator;
  if (
    !Number.isFinite(distanceAlongBearingMeters) ||
    distanceAlongBearingMeters < 0
  ) {
    return undefined;
  }
  const rawDistanceAlongTrackMeters =
    cross2d(delta, bearingDirection) / denominator;
  if (!Number.isFinite(rawDistanceAlongTrackMeters)) {
    return undefined;
  }
  const distanceAlongTrackMeters =
    Math.abs(rawDistanceAlongTrackMeters) < 1e-8
      ? 0
      : rawDistanceAlongTrackMeters;
  return {
    observation,
    position: {
      x:
        observation.ownshipPosition.x +
        bearingDirection.x * distanceAlongBearingMeters,
      z:
        observation.ownshipPosition.z +
        bearingDirection.z * distanceAlongBearingMeters,
    },
    distanceAlongTrackMeters,
    distanceAlongBearingMeters,
  };
}

export function strategicPlotWorldToCanvas(
  world: Vec2,
  center: Vec2,
  halfSpanMeters: number,
  canvasWidth: number,
  canvasHeight: number,
  viewYawRad = 0,
): StrategicPlotPoint {
  const scale = Math.min(canvasWidth, canvasHeight) / (halfSpanMeters * 2);
  const deltaX = world.x - center.x;
  const deltaZ = world.z - center.z;
  const cosine = Math.cos(viewYawRad);
  const sine = Math.sin(viewYawRad);
  return {
    x: canvasWidth * 0.5 + (deltaX * cosine + deltaZ * sine) * scale,
    y: canvasHeight * 0.5 + (-deltaX * sine + deltaZ * cosine) * scale,
  };
}

export function strategicDevelopmentEnemyMarker(
  frame: StrategicPlotFrame,
  enemyPosition: Vec2,
  halfSpanMeters: number,
  canvasWidth: number,
  canvasHeight: number,
  margin = 0,
): StrategicEnemyMarker {
  const projected = strategicPlotWorldToCanvas(
    enemyPosition,
    frame.ownship.position,
    halfSpanMeters,
    canvasWidth,
    canvasHeight,
    frame.viewYawRad,
  );
  const center = { x: canvasWidth * 0.5, y: canvasHeight * 0.5 };
  const deltaX = projected.x - center.x;
  const deltaY = projected.y - center.y;
  const availableX = Math.max(0, canvasWidth * 0.5 - margin);
  const availableY = Math.max(0, canvasHeight * 0.5 - margin);
  const scaleX = Math.abs(deltaX) < 1e-8 ? 1 : availableX / Math.abs(deltaX);
  const scaleY = Math.abs(deltaY) < 1e-8 ? 1 : availableY / Math.abs(deltaY);
  const projectionScale = Math.min(1, scaleX, scaleY);
  return {
    point: {
      x: center.x + deltaX * projectionScale,
      y: center.y + deltaY * projectionScale,
    },
    directionRad: Math.atan2(deltaX, -deltaY),
    offPlot: projectionScale < 1,
  };
}

export function strategicDisplayHeading(
  worldHeadingRad: number,
  viewYawRad = 0,
): number {
  const relativeHeading = worldHeadingRad - viewYawRad;
  return Math.atan2(Math.sin(relativeHeading), Math.cos(relativeHeading));
}

export function strategicViewTransformChanged(
  previousFrame: StrategicPlotFrame | undefined,
  nextFrame: StrategicPlotFrame,
): boolean {
  if (previousFrame === undefined) {
    return true;
  }
  const previousSpan = previousFrame.viewHalfSpanMeters;
  const nextSpan = nextFrame.viewHalfSpanMeters;
  if (previousSpan === undefined || nextSpan === undefined) {
    if (previousSpan !== nextSpan) {
      return true;
    }
  } else if (
    Math.abs(nextSpan - previousSpan) > Math.max(0.5, previousSpan * 0.0005)
  ) {
    return true;
  }
  const previousPlan = previousFrame.torpedoPlan;
  const nextPlan = nextFrame.torpedoPlan;
  if (previousPlan?.status !== nextPlan?.status) {
    return true;
  }
  if (
    previousPlan !== undefined &&
    nextPlan !== undefined &&
    (Math.abs(previousPlan.enablePoint.x - nextPlan.enablePoint.x) >
      TORPEDO_MARKER_MOTION_EPSILON_METERS ||
      Math.abs(previousPlan.enablePoint.z - nextPlan.enablePoint.z) >
        TORPEDO_MARKER_MOTION_EPSILON_METERS)
  ) {
    return true;
  }
  const previousPlans = previousFrame.torpedoPlans ?? [];
  const nextPlans = nextFrame.torpedoPlans ?? [];
  if (
    previousPlans.length !== nextPlans.length ||
    previousPlans.some((plan, index) => {
      const next = nextPlans[index];
      return (
        next === undefined ||
        plan.status !== next.status ||
        Math.abs(plan.enablePoint.x - next.enablePoint.x) > 0.5 ||
        Math.abs(plan.enablePoint.z - next.enablePoint.z) > 0.5
      );
    })
  ) {
    return true;
  }
  const previousPrediction = previousFrame.torpedoTargetPrediction;
  const nextPrediction = nextFrame.torpedoTargetPrediction;
  if (
    previousPrediction?.trackId !== nextPrediction?.trackId ||
    previousPrediction?.selectionMode !== nextPrediction?.selectionMode ||
    previousPrediction?.candidateIndex !== nextPrediction?.candidateIndex ||
    previousPrediction?.candidateCount !== nextPrediction?.candidateCount
  ) {
    return true;
  }
  if (
    previousPrediction !== undefined &&
    nextPrediction !== undefined &&
    (Math.abs(
      previousPrediction.predictedPosition.x -
        nextPrediction.predictedPosition.x,
    ) > 0.5 ||
      Math.abs(
        previousPrediction.predictedPosition.z -
          nextPrediction.predictedPosition.z,
      ) > 0.5)
  ) {
    return true;
  }
  return (
    Math.abs(
      strategicDisplayHeading(
        nextFrame.viewYawRad ?? 0,
        previousFrame.viewYawRad ?? 0,
      ),
    ) > 0.0005
  );
}

export function strategicTorpedoMarkerMoved(
  previousFrame: StrategicPlotFrame | undefined,
  nextFrame: StrategicPlotFrame,
): boolean {
  const nextPlan = nextFrame.torpedoPlan;
  if (nextPlan?.status !== "placing") {
    return false;
  }
  const previousPlan = previousFrame?.torpedoPlan;
  if (previousPlan?.status !== "placing") {
    return true;
  }
  return (
    Math.abs(previousPlan.enablePoint.x - nextPlan.enablePoint.x) >
      TORPEDO_MARKER_MOTION_EPSILON_METERS ||
    Math.abs(previousPlan.enablePoint.z - nextPlan.enablePoint.z) >
      TORPEDO_MARKER_MOTION_EPSILON_METERS
  );
}

function strategicCurrentMotionObservations(
  track: ContactTrackSnapshot,
): readonly BearingObservation[] {
  return (
    track.motionLegs[track.currentMotionLegIndex]?.observations ??
    track.observations
  );
}

function stabilizeStrategicTrackHistory(
  previous: StrategicTrackHistory,
  sampled: StrategicTrackHistory,
  observations: readonly BearingObservation[],
  followAmount: number,
): StrategicTrackHistory {
  const amount = clamp(followAmount, 0, 1);
  const courseDelta = Math.atan2(
    Math.sin(sampled.courseRad - previous.courseRad),
    Math.cos(sampled.courseRad - previous.courseRad),
  );
  const courseRad = previous.courseRad + courseDelta * amount;
  const currentPosition = {
    x:
      previous.currentPosition.x +
      (sampled.currentPosition.x - previous.currentPosition.x) * amount,
    z:
      previous.currentPosition.z +
      (sampled.currentPosition.z - previous.currentPosition.z) * amount,
  };
  const direction = {
    x: Math.sin(courseRad),
    z: -Math.cos(courseRad),
  };
  const intersections = strategicBearingHistorySamples(observations).flatMap(
    (observation) => {
      const intersection = strategicBearingTrackIntersection(
        observation,
        currentPosition,
        direction,
      );
      return intersection === undefined ? [] : [intersection];
    },
  );
  return {
    currentPosition,
    courseRad,
    speedMps:
      previous.speedMps + (sampled.speedMps - previous.speedMps) * amount,
    confidence:
      previous.confidence + (sampled.confidence - previous.confidence) * amount,
    intersections,
  };
}

function niceGridStep(halfSpanMeters: number): number {
  if (halfSpanMeters <= 7_500) {
    return 1_000;
  }
  if (halfSpanMeters <= 20_000) {
    return 5_000;
  }
  if (halfSpanMeters <= 50_000) {
    return 10_000;
  }
  return 20_000;
}

function normalizedHypothesisWeights(solution: TmaSolution): readonly number[] {
  const safeWeights = solution.hypotheses.map((hypothesis) =>
    Number.isFinite(hypothesis.weight) && hypothesis.weight > 0
      ? hypothesis.weight
      : 0,
  );
  const total = safeWeights.reduce((sum, weight) => sum + weight, 0);
  if (total > 0) {
    return safeWeights.map((weight) => weight / total);
  }
  const equalWeight = 1 / solution.hypotheses.length;
  return solution.hypotheses.map(() => equalWeight);
}

function pointAlongTrack(
  origin: Vec2,
  direction: Vec2,
  distanceMeters: number,
): Vec2 {
  return {
    x: origin.x + direction.x * distanceMeters,
    z: origin.z + direction.z * distanceMeters,
  };
}

function cross2d(left: Vec2, right: Vec2): number {
  return left.x * right.z - left.z * right.x;
}

function formatDistance(meters: number): string {
  return meters < 1_000
    ? `${Math.round(meters).toString()} M`
    : `${(meters / 1_000).toFixed(meters < 10_000 ? 1 : 0)} KM`;
}

function formatLocalChartDimensions(): string {
  const widthKm = (MAP_HALF_WIDTH * 2) / 1_000;
  const lengthKm = (MAP_HALF_LENGTH * 2) / 1_000;
  return `${widthKm.toFixed(1)} × ${lengthKm.toFixed(1)} KM`;
}

function formatHeading(headingRad: number): string {
  const degrees = Math.round(
    ((((headingRad * 180) / Math.PI) % 360) + 360) % 360,
  );
  return `${degrees.toString().padStart(3, "0")}°`;
}

function strategicTrackUncertaintyGrowth(
  track: ContactTrackSnapshot,
  timeSeconds: number,
): number {
  const ageSeconds = Math.max(
    0,
    timeSeconds - track.lastObservationTimeSeconds,
  );
  const lostGrowth = track.status === "LOST" ? ageSeconds * 16 : 0;
  const weakGrowth = track.status === "WEAK" ? ageSeconds * 4 : 0;
  const maneuverGrowth = track.possibleManeuver
    ? Math.max(240, track.solution?.weightedSpreadMeters ?? 0) * 0.55
    : 0;
  return lostGrowth + weakGrowth + maneuverGrowth;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
