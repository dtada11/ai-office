// ── Employee chat windows ───────────────────────────────────────
/** Where the first chat window opens (px from the top-left of the office). */
export const CHAT_START_PX = 40;
/** Each further window opens this much down-right of the last, so all stay readable. */
export const CHAT_STAGGER_PX = 40;
/** Horizontal px of a dragged window that must stay on screen — enough to grab it back. */
export const CHAT_MIN_VISIBLE_PX = 80;
/** Vertical px that must stay on screen: the header, which is the drag handle. */
export const CHAT_HEADER_VISIBLE_PX = 32;
/** Smallest a resized chat window can shrink to — still room for the header,
 *  a couple of log lines, and the input row. */
export const CHAT_MIN_WIDTH_PX = 340;
export const CHAT_MIN_HEIGHT_PX = 320;
/** Largest a resized window can grow to, as a fraction of the viewport. Some
 *  sliver of office stays visible either way — the point of a pixel office is
 *  seeing who is doing what while you read.
 *
 *  Width is the looser of the two because the board window opens three chat
 *  widths across, and a ceiling below its own default would snap it smaller the
 *  instant anyone touched a resize handle. */
export const CHAT_MAX_WIDTH_RATIO = 0.9;
export const CHAT_MAX_HEIGHT_RATIO = 0.7;
/** The two rules that keep hand-dragged chat windows usable: a window can never
 *  be thrown off-screen and lost, and the window you touch comes to the front.
 *  Kept as plain functions so both are decidable without a DOM. */

export interface ChatPosition {
  x: number;
  y: number;
}

export interface ChatSize {
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/** Where the nth window opens. Pinned at open time, not derived from render
 *  order — bring-to-front rewrites that order, and the window would jump. */
export function initialChatPosition(index: number): ChatPosition {
  return { x: CHAT_START_PX + index * CHAT_STAGGER_PX, y: CHAT_START_PX };
}

/** Enough of the header — the drag handle and the ✕ — always stays on screen to
 *  drag the window back. */
export function clampChatPosition(pos: ChatPosition, viewport: Viewport): ChatPosition {
  return {
    x: Math.min(Math.max(0, pos.x), Math.max(0, viewport.width - CHAT_MIN_VISIBLE_PX)),
    y: Math.min(Math.max(0, pos.y), Math.max(0, viewport.height - CHAT_HEADER_VISIBLE_PX)),
  };
}

/** Windows stack in render order, so "to the front" is "to the end of the list". */
export function bringToFront(openChats: number[], agentId: number): number[] {
  if (!openChats.includes(agentId)) return openChats;
  return [...openChats.filter((id) => id !== agentId), agentId];
}

/** Never smaller than the min (the window stops being usable below that), and
 *  never larger than CHAT_MAX_*_RATIO of the viewport — a chat window that
 *  covers the office hides the very thing this tool is for (seeing what the
 *  team is doing while you read). At a 0.7 ratio this cap is always tighter
 *  than "viewport minus a small margin" would have been, so there is no
 *  separate margin term to reconcile with it. */
export function clampChatSize(size: ChatSize, viewport: Viewport): ChatSize {
  return {
    width: Math.min(
      Math.max(CHAT_MIN_WIDTH_PX, size.width),
      Math.max(CHAT_MIN_WIDTH_PX, viewport.width * CHAT_MAX_WIDTH_RATIO),
    ),
    height: Math.min(
      Math.max(CHAT_MIN_HEIGHT_PX, size.height),
      Math.max(CHAT_MIN_HEIGHT_PX, viewport.height * CHAT_MAX_HEIGHT_RATIO),
    ),
  };
}
