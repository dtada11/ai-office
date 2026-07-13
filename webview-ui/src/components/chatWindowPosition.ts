/** The two rules that keep hand-dragged chat windows usable: a window can never
 *  be thrown off-screen and lost, and the window you touch comes to the front.
 *  Kept as plain functions so both are decidable without a DOM. */

import {
  CHAT_HEADER_VISIBLE_PX,
  CHAT_MIN_VISIBLE_PX,
  CHAT_STAGGER_PX,
  CHAT_START_PX,
} from '../constants.js';

export interface ChatPosition {
  x: number;
  y: number;
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
