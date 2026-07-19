import {
  MATRIX_HEAD_COLOR,
  matrixGreenBright,
  matrixGreenDim,
  matrixGreenMid,
} from '../../constants.js';
import type { Character, SpriteData } from '../types.js';
import { MATRIX_EFFECT_DURATION } from '../types.js';

// ── Matrix Effect ───────────────────────────────────────────────
const MATRIX_TRAIL_LENGTH = 6;
const MATRIX_SPRITE_COLS = 16;
const MATRIX_SPRITE_ROWS = 24;
const MATRIX_FLICKER_FPS = 30;
const MATRIX_FLICKER_VISIBILITY_THRESHOLD = 180;
const MATRIX_COLUMN_STAGGER_RANGE = 0.3;
const MATRIX_TRAIL_OVERLAY_ALPHA = 0.6;
const MATRIX_TRAIL_EMPTY_ALPHA = 0.5;
const MATRIX_TRAIL_MID_THRESHOLD = 0.33;
const MATRIX_TRAIL_DIM_THRESHOLD = 0.66;

/** Hash-based flicker: ~70% visible for shimmer effect */
function flickerVisible(col: number, row: number, time: number): boolean {
  const t = Math.floor(time * MATRIX_FLICKER_FPS);
  const hash = (col * 7 + row * 13 + t * 31) & 0xff;
  return hash < MATRIX_FLICKER_VISIBILITY_THRESHOLD;
}

function generateSeeds(): number[] {
  const seeds: number[] = [];
  for (let i = 0; i < MATRIX_SPRITE_COLS; i++) {
    seeds.push(Math.random());
  }
  return seeds;
}

/**
 * Arm a character's spawn/despawn sweep. The three fields move together —
 * a stale timer or a leftover seed array from the previous effect makes the
 * sweep start mid-animation — so they are set in one place.
 */
export function startMatrixEffect(ch: Character, mode: 'spawn' | 'despawn'): void {
  ch.matrixEffect = mode;
  ch.matrixEffectTimer = 0;
  ch.matrixEffectSeeds = generateSeeds();
}

/**
 * Render a character with a Matrix-style digital rain spawn/despawn effect.
 * Per-pixel rendering: each column sweeps top-to-bottom with a bright head and fading green trail.
 */
export function renderMatrixEffect(
  ctx: CanvasRenderingContext2D,
  ch: Character,
  spriteData: SpriteData,
  drawX: number,
  drawY: number,
  zoom: number,
): void {
  const progress = ch.matrixEffectTimer / MATRIX_EFFECT_DURATION;
  const isSpawn = ch.matrixEffect === 'spawn';
  const time = ch.matrixEffectTimer;
  // Sweep the actual sprite's pixel dimensions, not the built-in pack's fixed
  // 16x24 (MATRIX_SPRITE_COLS/ROWS) — a custom higher-res pack (e.g. 32x64)
  // would otherwise only ever animate its top-left 16x24 corner, leaving the
  // rest of the sprite either undrawn (spawn) or instantly cut (despawn).
  // Same "actual size, 16 as fallback" pattern renderer.ts already uses for
  // charScale (spriteData[0]?.length || 16).
  const spriteCols = spriteData[0]?.length || MATRIX_SPRITE_COLS;
  const spriteRows = spriteData.length || MATRIX_SPRITE_ROWS;
  const totalSweep = spriteRows + MATRIX_TRAIL_LENGTH;

  for (let col = 0; col < spriteCols; col++) {
    // Stagger: each column starts at a slightly different time. Seeds are
    // generated at MATRIX_SPRITE_COLS length (see generateSeeds() above);
    // wrap around for sprites wider than that instead of defaulting the
    // extra columns to zero stagger (which would sweep them with no offset).
    const stagger =
      (ch.matrixEffectSeeds[col % ch.matrixEffectSeeds.length] ?? 0) * MATRIX_COLUMN_STAGGER_RANGE;
    const colProgress = Math.max(
      0,
      Math.min(1, (progress - stagger) / (1 - MATRIX_COLUMN_STAGGER_RANGE)),
    );
    const headRow = colProgress * totalSweep;

    for (let row = 0; row < spriteRows; row++) {
      const pixel = spriteData[row]?.[col];
      const hasPixel = pixel && pixel !== '';
      const distFromHead = headRow - row;
      const px = drawX + col * zoom;
      const py = drawY + row * zoom;

      if (isSpawn) {
        // Spawn: head sweeps down revealing character pixels
        if (distFromHead < 0) {
          // Above head: invisible
          continue;
        } else if (distFromHead < 1) {
          // Head pixel: bright white-green
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(px, py, zoom, zoom);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          // Trail zone: show character pixel with green overlay, or just green if no pixel
          const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
          if (hasPixel) {
            // Draw original pixel
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
            // Green overlay that fades as trail progresses
            const greenAlpha = (1 - trailPos) * MATRIX_TRAIL_OVERLAY_ALPHA;
            if (flickerVisible(col, row, time)) {
              ctx.fillStyle = matrixGreenBright(greenAlpha);
              ctx.fillRect(px, py, zoom, zoom);
            }
          } else {
            // No character pixel: fading green trail
            if (flickerVisible(col, row, time)) {
              const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
              ctx.fillStyle =
                trailPos < MATRIX_TRAIL_MID_THRESHOLD
                  ? matrixGreenBright(alpha)
                  : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                    ? matrixGreenMid(alpha)
                    : matrixGreenDim(alpha);
              ctx.fillRect(px, py, zoom, zoom);
            }
          }
        } else {
          // Below trail: normal character pixel
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
          }
        }
      } else {
        // Despawn: head sweeps down consuming character pixels
        if (distFromHead < 0) {
          // Above head: normal character pixel (not yet consumed)
          if (hasPixel) {
            ctx.fillStyle = pixel;
            ctx.fillRect(px, py, zoom, zoom);
          }
        } else if (distFromHead < 1) {
          // Head pixel: bright white-green
          ctx.fillStyle = MATRIX_HEAD_COLOR;
          ctx.fillRect(px, py, zoom, zoom);
        } else if (distFromHead < MATRIX_TRAIL_LENGTH) {
          // Trail zone: fading green
          if (flickerVisible(col, row, time)) {
            const trailPos = distFromHead / MATRIX_TRAIL_LENGTH;
            const alpha = (1 - trailPos) * MATRIX_TRAIL_EMPTY_ALPHA;
            ctx.fillStyle =
              trailPos < MATRIX_TRAIL_MID_THRESHOLD
                ? matrixGreenBright(alpha)
                : trailPos < MATRIX_TRAIL_DIM_THRESHOLD
                  ? matrixGreenMid(alpha)
                  : matrixGreenDim(alpha);
            ctx.fillRect(px, py, zoom, zoom);
          }
        }
        // Below trail: nothing (consumed)
      }
    }
  }
}
