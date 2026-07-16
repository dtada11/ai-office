import { DEFAULT_COLS, DEFAULT_ROWS, TILE_SIZE, ZOOM_MAX,ZOOM_MIN } from '../constants.js';

/** Map status prefixes back to tool names for animation selection */
const STATUS_TO_TOOL: Record<string, string> = {
  Reading: 'Read',
  Searching: 'Grep',
  Globbing: 'Glob',
  Fetching: 'WebFetch',
  'Searching web': 'WebSearch',
  Writing: 'Write',
  Editing: 'Edit',
  Running: 'Bash',
  Task: 'Task',
};

export function extractToolName(status: string): string | null {
  for (const [prefix, tool] of Object.entries(STATUS_TO_TOOL)) {
    if (status.startsWith(prefix)) return tool;
  }
  const first = status.split(/[\s:]/)[0];
  return first || null;
}

/** Compute a default integer zoom level (device pixels per sprite pixel).
 * Considers both device pixel ratio and viewport size to show a reasonable
 * portion of the office without excessive scrolling on wide displays. */
export function defaultZoom(): number {
  const dpr = window.devicePixelRatio || 1;

  // Layout size in world pixels (zoom level 1)
  const officeWidthPx = DEFAULT_COLS * TILE_SIZE; // ~320px
  const officeHeightPx = DEFAULT_ROWS * TILE_SIZE; // ~176px

  // Viewport size
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  // Fit office into ~80% of viewport (leave room for UI)
  const zoomFromWidth = (viewportWidth * 0.8) / officeWidthPx;
  const zoomFromHeight = (viewportHeight * 0.8) / officeHeightPx;
  const zoomFromViewport = Math.min(zoomFromWidth, zoomFromHeight);

  // Apply device pixel ratio to maintain relative sizes on high-DPI displays
  const baseZoom = Math.max(1, zoomFromViewport * dpr);

  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(baseZoom)));
}

// ── Provider capabilities (tool taxonomy for rendering decisions) ────────────
// Populated once by the `providerCapabilities` postMessage after `webviewReady`.
// Modules classifying tools (character animation, subagent creation gate) read
// from here instead of hardcoding Claude-specific tool names.

const providerCaps: {
  readingTools: Set<string>;
  subagentToolNames: Set<string>;
} = {
  readingTools: new Set(),
  subagentToolNames: new Set(),
};

export function setProviderCapabilities(caps: {
  readingTools: string[];
  subagentToolNames: string[];
}): void {
  providerCaps.readingTools = new Set(caps.readingTools);
  providerCaps.subagentToolNames = new Set(caps.subagentToolNames);
}

export function isReadingToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.readingTools.has(name);
}

export function isSubagentToolName(name: string | null | undefined): boolean {
  return typeof name === 'string' && providerCaps.subagentToolNames.has(name);
}
