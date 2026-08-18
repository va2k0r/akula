import {
  ICE_KEELS,
  MAP_HALF_LENGTH,
  MAP_HALF_WIDTH,
  channelWallAt,
  clamp,
  terrainHeightAt,
} from "./WorldGeometry";

export const MINI_MAP_UPDATE_HZ = 8;
export const MINI_MAP_LOD = Object.freeze({ columns: 48, rows: 40 });

const MINI_MAP_UPDATE_INTERVAL = 1 / MINI_MAP_UPDATE_HZ;
const MAXIMUM_PIXEL_RATIO = 1.25;

export interface MiniMapFrame {
  readonly player: Readonly<{
    x: number;
    z: number;
    heading: number;
  }>;
  readonly contact?: Readonly<{
    worldBearing: number;
    signalQuality: number;
  }>;
  /** Temporary exact contact truth shown while the prototype is in development. */
  readonly developmentEnemy?: Readonly<{
    position: Readonly<{ x: number; z: number }>;
    headingRad: number;
  }>;
}

export interface MiniMapUnitPoint {
  readonly x: number;
  readonly y: number;
}

export interface MiniMapEnemyMarker {
  readonly position: Readonly<{ x: number; z: number }>;
  readonly bearingRad: number;
  readonly offChart: boolean;
}

export function miniMapWorldToUnit(x: number, z: number): MiniMapUnitPoint {
  return {
    x: clamp((x + MAP_HALF_WIDTH) / (MAP_HALF_WIDTH * 2), 0, 1),
    y: clamp((z + MAP_HALF_LENGTH) / (MAP_HALF_LENGTH * 2), 0, 1),
  };
}

export function miniMapRayToBoundary(
  x: number,
  z: number,
  worldBearing: number,
): Readonly<{ x: number; z: number }> {
  const directionX = Math.sin(worldBearing);
  const directionZ = -Math.cos(worldBearing);
  const distanceToX =
    Math.abs(directionX) < 1e-8
      ? Number.POSITIVE_INFINITY
      : ((directionX > 0 ? MAP_HALF_WIDTH : -MAP_HALF_WIDTH) - x) / directionX;
  const distanceToZ =
    Math.abs(directionZ) < 1e-8
      ? Number.POSITIVE_INFINITY
      : ((directionZ > 0 ? MAP_HALF_LENGTH : -MAP_HALF_LENGTH) - z) /
        directionZ;
  const distance = Math.max(0, Math.min(distanceToX, distanceToZ));
  return {
    x: x + directionX * distance,
    z: z + directionZ * distance,
  };
}

export function miniMapEnemyMarker(
  player: Readonly<{ x: number; z: number }>,
  enemy: Readonly<{ x: number; z: number }>,
): MiniMapEnemyMarker {
  const deltaX = enemy.x - player.x;
  const deltaZ = enemy.z - player.z;
  const bearingRad = Math.atan2(deltaX, -deltaZ);
  const offChart =
    enemy.x < -MAP_HALF_WIDTH ||
    enemy.x > MAP_HALF_WIDTH ||
    enemy.z < -MAP_HALF_LENGTH ||
    enemy.z > MAP_HALF_LENGTH;
  return {
    position: offChart
      ? miniMapRayToBoundary(player.x, player.z, bearingRad)
      : enemy,
    bearingRad,
    offChart,
  };
}

/**
 * North-up chart derived from the same MAREANO terrain as the 3D world. It is
 * deliberately a small 2D canvas: no second WebGL context, no scene traversal,
 * and no extra post-processing pass.
 */
export class TacticalMiniMap {
  private readonly staticChart = document.createElement("canvas");
  private readonly context: CanvasRenderingContext2D;
  private nextRenderAt = 0;
  private lastFrame: MiniMapFrame | undefined;
  private pixelRatio = 1;

  public constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d", { alpha: true });
    if (context === null) {
      throw new Error("The tactical minimap requires a 2D canvas context.");
    }
    this.context = context;
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
    if (this.canvas.width === width && this.canvas.height === height) {
      return;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.staticChart.width = width;
    this.staticChart.height = height;
    this.renderStaticChart();
    if (this.lastFrame !== undefined) {
      this.render(this.lastFrame);
    }
  }

  public update(frame: MiniMapFrame, elapsedSeconds: number): void {
    this.lastFrame = frame;
    if (this.canvas.width < 2 || this.canvas.height < 2) {
      this.resize();
    }
    if (elapsedSeconds + 1e-6 < this.nextRenderAt) {
      return;
    }
    this.nextRenderAt = elapsedSeconds + MINI_MAP_UPDATE_INTERVAL;
    this.render(frame);
  }

  public dispose(): void {
    this.canvas.width = 1;
    this.canvas.height = 1;
    this.staticChart.width = 1;
    this.staticChart.height = 1;
  }

  private renderStaticChart(): void {
    const context = this.staticChart.getContext("2d", { alpha: true });
    if (context === null) {
      return;
    }
    const width = this.staticChart.width;
    const height = this.staticChart.height;
    context.clearRect(0, 0, width, height);
    context.fillStyle = "rgba(3, 11, 10, 0.92)";
    context.fillRect(0, 0, width, height);

    const cellWidth = width / MINI_MAP_LOD.columns;
    const cellHeight = height / MINI_MAP_LOD.rows;
    for (let row = 0; row < MINI_MAP_LOD.rows; row += 1) {
      const z =
        -MAP_HALF_LENGTH +
        ((row + 0.5) / MINI_MAP_LOD.rows) * MAP_HALF_LENGTH * 2;
      for (let column = 0; column < MINI_MAP_LOD.columns; column += 1) {
        const x =
          -MAP_HALF_WIDTH +
          ((column + 0.5) / MINI_MAP_LOD.columns) * MAP_HALF_WIDTH * 2;
        const heightFactor = clamp((terrainHeightAt(x, z) + 370) / 300, 0, 1);
        const depthBand = Math.round(heightFactor * 7) / 7;
        const red = Math.round(10 + depthBand * 62);
        const green = Math.round(25 + depthBand * 75);
        const blue = Math.round(24 + depthBand * 54);
        context.fillStyle = `rgb(${red} ${green} ${blue})`;
        context.fillRect(
          Math.floor(column * cellWidth),
          Math.floor(row * cellHeight),
          Math.ceil(cellWidth + 0.6),
          Math.ceil(cellHeight + 0.6),
        );
      }
    }

    this.drawGrid(context);
    this.drawPrimaryTrough(context);
    this.drawIceHazards(context);

    context.strokeStyle = "rgba(190, 211, 178, 0.36)";
    context.lineWidth = this.pixelRatio;
    context.strokeRect(
      this.pixelRatio * 0.5,
      this.pixelRatio * 0.5,
      width - this.pixelRatio,
      height - this.pixelRatio,
    );
  }

  private drawGrid(context: CanvasRenderingContext2D): void {
    context.save();
    context.strokeStyle = "rgba(188, 208, 177, 0.09)";
    context.lineWidth = this.pixelRatio * 0.7;
    for (let x = -MAP_HALF_WIDTH; x <= MAP_HALF_WIDTH; x += 500) {
      const point = this.toCanvasPoint(x, 0);
      context.beginPath();
      context.moveTo(point.x, 0);
      context.lineTo(point.x, this.canvas.height);
      context.stroke();
    }
    for (let z = -MAP_HALF_LENGTH; z <= MAP_HALF_LENGTH; z += 500) {
      const point = this.toCanvasPoint(0, z);
      context.beginPath();
      context.moveTo(0, point.y);
      context.lineTo(this.canvas.width, point.y);
      context.stroke();
    }
    context.restore();
  }

  private drawPrimaryTrough(context: CanvasRenderingContext2D): void {
    context.save();
    context.strokeStyle = "rgba(193, 215, 185, 0.32)";
    context.lineWidth = this.pixelRatio;
    context.setLineDash([this.pixelRatio * 2.5, this.pixelRatio * 4]);
    for (const side of [-1, 1] as const) {
      context.beginPath();
      for (let index = 0; index <= 48; index += 1) {
        const z = -MAP_HALF_LENGTH + (index / 48) * MAP_HALF_LENGTH * 2;
        const x = channelWallAt(z, side);
        const point = this.toCanvasPoint(x, z);
        if (index === 0) {
          context.moveTo(point.x, point.y);
        } else {
          context.lineTo(point.x, point.y);
        }
      }
      context.stroke();
    }
    context.restore();
  }

  private drawIceHazards(context: CanvasRenderingContext2D): void {
    context.save();
    context.fillStyle = "rgba(199, 163, 98, 0.13)";
    context.strokeStyle = "rgba(214, 178, 108, 0.7)";
    context.lineWidth = this.pixelRatio;
    for (const keel of ICE_KEELS) {
      const center = this.toCanvasPoint(keel.x, keel.z);
      context.beginPath();
      context.ellipse(
        center.x,
        center.y,
        (keel.radiusX / (MAP_HALF_WIDTH * 2)) * this.canvas.width,
        (keel.radiusZ / (MAP_HALF_LENGTH * 2)) * this.canvas.height,
        keel.rotation,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.stroke();
    }
    context.restore();
  }

  private render(frame: MiniMapFrame): void {
    const context = this.context;
    const width = this.canvas.width;
    const height = this.canvas.height;
    context.clearRect(0, 0, width, height);
    context.imageSmoothingEnabled = false;
    context.drawImage(this.staticChart, 0, 0);

    const player = this.toCanvasPoint(frame.player.x, frame.player.z);
    if (frame.contact !== undefined) {
      this.drawContactBearing(context, frame);
    }
    if (frame.developmentEnemy !== undefined) {
      this.drawDevelopmentEnemy(context, frame);
    }
    this.drawPlayer(context, player, frame.player.heading);
  }

  private drawDevelopmentEnemy(
    context: CanvasRenderingContext2D,
    frame: MiniMapFrame,
  ): void {
    const enemy = frame.developmentEnemy;
    if (enemy === undefined) {
      return;
    }
    const marker = miniMapEnemyMarker(frame.player, enemy.position);
    const projected = this.toCanvasPoint(marker.position.x, marker.position.z);
    const margin = this.pixelRatio * 11;
    const point = marker.offChart
      ? {
          x: clamp(projected.x, margin, this.canvas.width - margin),
          y: clamp(projected.y, margin, this.canvas.height - margin),
        }
      : projected;
    const scale = this.pixelRatio;

    context.save();
    context.translate(point.x, point.y);
    context.rotate(marker.offChart ? marker.bearingRad : enemy.headingRad);
    context.shadowColor = "rgba(255, 91, 58, 0.92)";
    context.shadowBlur = scale * 7;
    context.fillStyle = "rgba(255, 116, 72, 0.98)";
    context.strokeStyle = "rgba(255, 222, 192, 0.98)";
    context.lineWidth = scale;
    context.beginPath();
    if (marker.offChart) {
      context.moveTo(0, -scale * 8);
      context.lineTo(scale * 5.5, scale * 5);
      context.lineTo(0, scale * 2.5);
      context.lineTo(-scale * 5.5, scale * 5);
    } else {
      context.moveTo(0, -scale * 6.5);
      context.lineTo(scale * 5.5, 0);
      context.lineTo(0, scale * 6.5);
      context.lineTo(-scale * 5.5, 0);
    }
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();

    context.save();
    context.fillStyle = "rgba(255, 194, 151, 0.98)";
    context.font = `700 ${Math.round(scale * 8)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.textAlign = point.x > this.canvas.width * 0.62 ? "right" : "left";
    context.fillText(
      marker.offChart ? "ENEMY · OFF MAP" : "ENEMY",
      point.x + (point.x > this.canvas.width * 0.62 ? -scale * 9 : scale * 9),
      point.y - scale * 7,
    );
    context.restore();
  }

  private drawContactBearing(
    context: CanvasRenderingContext2D,
    frame: MiniMapFrame,
  ): void {
    const start = this.toCanvasPoint(frame.player.x, frame.player.z);
    const boundary = miniMapRayToBoundary(
      frame.player.x,
      frame.player.z,
      frame.contact?.worldBearing ?? 0,
    );
    const end = this.toCanvasPoint(boundary.x, boundary.z);
    const opacity =
      0.16 + clamp(frame.contact?.signalQuality ?? 0, 0, 1) * 0.46;
    context.save();
    context.strokeStyle = `rgba(218, 237, 211, ${opacity.toFixed(3)})`;
    context.lineWidth = this.pixelRatio;
    context.setLineDash([this.pixelRatio * 3, this.pixelRatio * 4.5]);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.stroke();
    context.restore();
  }

  private drawPlayer(
    context: CanvasRenderingContext2D,
    point: MiniMapUnitPoint,
    heading: number,
  ): void {
    const scale = this.pixelRatio;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(heading);
    context.fillStyle = "rgba(231, 243, 226, 0.96)";
    context.shadowColor = "rgba(207, 231, 205, 0.48)";
    context.shadowBlur = scale * 5;
    context.beginPath();
    context.moveTo(0, -scale * 8.5);
    context.lineTo(scale * 4.5, scale * 6.5);
    context.lineTo(0, scale * 3.7);
    context.lineTo(-scale * 4.5, scale * 6.5);
    context.closePath();
    context.fill();
    context.restore();
  }

  private toCanvasPoint(x: number, z: number): MiniMapUnitPoint {
    const unit = miniMapWorldToUnit(x, z);
    return {
      x: unit.x * this.canvas.width,
      y: unit.y * this.canvas.height,
    };
  }
}
