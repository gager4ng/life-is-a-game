import { CanvasTexture, SRGBColorSpace } from "three";
import { css } from "../render/color";

/** Textures drawn on a canvas at start-up (no image files). */

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d")!];
}

/** Soft round glow (white to transparent) for lamp halos. */
export function glowTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Dark soft blob for cheap shadows under people and vehicles. */
export function blobTexture(): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 4, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

export interface SignCell {
  /** UV rectangle in the atlas: u0, v0, u1, v1. */
  uv: [number, number, number, number];
}

/**
 * All shop signs and place names in one texture: each sign is a cell with its board colour and
 * text, so every signboard in the city shares a single material and draw call.
 */
export class SignAtlas {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly cells = new Map<string, SignCell>();
  private next = 0;
  private static readonly W = 1024;
  private static readonly CELL_W = 256;
  private static readonly CELL_H = 64;

  constructor() {
    const [c, g] = canvas(SignAtlas.W, SignAtlas.W);
    this.ctx = g;
    this.texture = new CanvasTexture(c);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 2;
  }

  /** A cell with this text on this board colour (cached). */
  cell(text: string, board: number, ink = 0xffffff): SignCell {
    const key = `${text}|${board}|${ink}`;
    const have = this.cells.get(key);
    if (have) return have;
    const { W, CELL_W, CELL_H } = SignAtlas;
    const perRow = W / CELL_W;
    const i = this.next++;
    const x = (i % perRow) * CELL_W;
    const y = Math.floor(i / perRow) * CELL_H;
    if (y + CELL_H > W) return this.cell("", board, ink); // full: plain board (never expected)
    const g = this.ctx;
    g.fillStyle = css(board);
    g.fillRect(x, y, CELL_W, CELL_H);
    g.strokeStyle = "rgba(0,0,0,0.35)";
    g.lineWidth = 4;
    g.strokeRect(x + 2, y + 2, CELL_W - 4, CELL_H - 4);
    g.fillStyle = css(ink);
    let size = 30;
    g.font = `800 ${size}px system-ui, sans-serif`;
    while (size > 12 && g.measureText(text).width > CELL_W - 16) {
      size -= 2;
      g.font = `800 ${size}px system-ui, sans-serif`;
    }
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, x + CELL_W / 2, y + CELL_H / 2 + 1);
    this.texture.needsUpdate = true;
    // Canvas y runs down, texture v runs up.
    const cell: SignCell = {
      uv: [x / W, 1 - (y + CELL_H) / W, (x + CELL_W) / W, 1 - y / W],
    };
    this.cells.set(key, cell);
    return cell;
  }
}

/** A thin streak for rain drops. */
export function streakTexture(): CanvasTexture {
  const [c, g] = canvas(8, 64);
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, "rgba(220,235,255,0)");
  grad.addColorStop(1, "rgba(220,235,255,0.9)");
  g.fillStyle = grad;
  g.fillRect(3, 0, 2, 64);
  return new CanvasTexture(c);
}
