/** The two rules that keep hand-dragged chat windows usable: a window can never
 *  be thrown off-screen and lost, and the window you touch comes to the front.
 *  Kept as plain functions so both are decidable without a DOM. */

import {
  CHAT_HEADER_VISIBLE_PX,
  CHAT_MAX_HEIGHT_RATIO,
  CHAT_MAX_WIDTH_RATIO,
  CHAT_MIN_HEIGHT_PX,
  CHAT_MIN_VISIBLE_PX,
  CHAT_MIN_WIDTH_PX,
  CHAT_STAGGER_PX,
  CHAT_START_PX,
} from '../constants.js';

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
