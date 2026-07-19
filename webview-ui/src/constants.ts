// ── Grid & Layout ────────────────────────────────────────────
export const TILE_SIZE = 16;
export const DEFAULT_COLS = 20;
export const DEFAULT_ROWS = 11;
export const MAX_COLS = 64;
export const MAX_ROWS = 64;

// ── Matrix Effect ────────────────────────────────────────────
export const MATRIX_EFFECT_DURATION_SEC = 0.3;
export const MATRIX_HEAD_COLOR = '#ccffcc';
export const matrixGreenBright = (a: number): string => `rgba(0, 255, 65, ${a})`;
export const matrixGreenMid = (a: number): string => `rgba(0, 170, 40, ${a})`;
export const matrixGreenDim = (a: number): string => `rgba(0, 85, 20, ${a})`;

// ── Rendering ────────────────────────────────────────────────
export const CHARACTER_SITTING_OFFSET_PX = 6;
export const FALLBACK_FLOOR_COLOR = '#808080';

// ── Rendering - Overlay Colors (canvas, not CSS) ─────────────
export const SEAT_OWN_COLOR = 'rgba(0, 127, 212, 0.35)';
export const SEAT_AVAILABLE_COLOR = 'rgba(0, 200, 80, 0.35)';
export const SEAT_BUSY_COLOR = 'rgba(220, 50, 50, 0.35)';
export const GRID_LINE_COLOR = 'rgba(255,255,255,0.12)';
export const VOID_TILE_OUTLINE_COLOR = 'rgba(255,255,255,0.08)';
export const GHOST_BORDER_HOVER_FILL = 'rgba(60, 130, 220, 0.25)';
export const GHOST_BORDER_HOVER_STROKE = 'rgba(60, 130, 220, 0.5)';
export const GHOST_BORDER_STROKE = 'rgba(255, 255, 255, 0.06)';
export const GHOST_VALID_TINT = '#00ff00';
export const GHOST_INVALID_TINT = '#ff0000';
export const SELECTION_HIGHLIGHT_COLOR = '#007fd4';
export const DELETE_BUTTON_BG = 'rgba(200, 50, 50, 0.85)';
export const ROTATE_BUTTON_BG = 'rgba(50, 120, 200, 0.85)';
export const BUTTON_ICON_COLOR = '#fff';
export const CANVAS_FALLBACK_TILE_COLOR = '#444';
export const CANVAS_ERROR_TILE_COLOR = '#FF00FF';
export const WALL_COLOR = '#3A3A5C';

// ── Zoom ─────────────────────────────────────────────────────
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 10;

// ── Editor ───────────────────────────────────────────────────
export const UNDO_STACK_MAX_SIZE = 50;
export const LAYOUT_SAVE_DEBOUNCE_MS = 500;

// ── Agent Teams ─────────────────────────────────────────────
export const MAX_CONTEXT_TOKENS = 200_000;
export const TOKEN_WARN_THRESHOLD = 0.6;
export const TOKEN_DANGER_THRESHOLD = 0.8;
export const TOKEN_CRITICAL_THRESHOLD = 0.95;
export const FUEL_COLOR_OK = '#44cc44';
export const FUEL_COLOR_WARN = '#ffcc00';
export const FUEL_COLOR_DANGER = '#ff8800';
export const FUEL_COLOR_CRITICAL = '#ff2222';
export const FUEL_GAUGE_BG = '#222';
export const TEAM_LEAD_COLOR = '#ffd700';
export const TEAM_ROLE_COLOR = '#66aaff';

// ── Pets ────────────────────────────────────────────────────────
/** Fallback background fill for sprite-less thumbnail (used while pet sprites are loading). */
export const EMPTY_SPRITE_THUMBNAIL_BG = '#333';

// ── 팀 흐름 캔버스 (대시보드 탭) ─────────────────────────────────
/** Canvas colours for the delegate → collect diagram. Here rather than in the
 *  component because canvas paints are strings, not classes, and this project
 *  keeps every colour literal in one file. Values mirror the CSS tokens in
 *  index.css (--color-accent, --color-status-success, …) so the canvas and the
 *  DOM around it stay the same office. */
export const FLOW_WIRE_COLOR = 'rgba(116, 111, 255, 0.18)';
export const FLOW_LEAD_FILL = '#6030ff';
export const FLOW_LEAD_BORDER = '#746fff';
export const FLOW_NODE_FILL = '#2a2a3a';
export const FLOW_NODE_BORDER = '#4a4a6a';
export const FLOW_ACTIVE_FILL = '#20402c';
export const FLOW_ACTIVE_BORDER = '#89d185';
export const FLOW_PERM_FILL = '#3a2f1a';
export const FLOW_PERM_BORDER = '#cca700';
export const FLOW_LABEL_COLOR = 'rgba(255, 255, 255, 0.9)';
/** Colour builders for the flow canvas. Composing `rgba(…)` at the call site
 *  would be an inline colour literal (the lint rule reads template strings
 *  too), and the packet trail genuinely needs a per-frame alpha — so the
 *  composition lives here, in the one file colours are allowed in. */
export function flowRgba(rgb: string, alpha: number): string {
  return `rgba(${rgb}, ${alpha})`;
}
export function flowRgb(rgb: string): string {
  return `rgb(${rgb})`;
}
