import { useEffect, useRef, useState } from 'react';

import type { ChatPosition, ChatSize } from '../components/chatWindowPosition.js';
import { clampChatPosition, clampChatSize } from '../components/chatWindowPosition.js';

/** The floating-window mechanism shared by every draggable panel in the office:
 *  grab the header to move, grab the corner to resize, and never end up
 *  somewhere you cannot grab again (clampChatPosition / clampChatSize own that
 *  rule, and stay pure so they are decidable without a DOM).
 *
 *  Extracted verbatim from EmployeeChat, which was the only window with a
 *  resize handle, so the board window could have the same feel without a second
 *  copy of it drifting away from the first.
 *
 *  Position and size are NOT state here. They belong to the caller — App keeps
 *  them per window so closing and reopening a window puts it back where the
 *  user left it, which only works if the value outlives the component. What is
 *  state here is the gesture in progress, which does not.
 */

/** Which dimensions a resize gesture is allowed to change. The right edge only
 *  widens, the bottom edge only heightens, the corner does both — the same split
 *  every desktop window manager uses, so dragging an edge cannot nudge the other
 *  dimension by accident. */
export type ResizeAxis = 'both' | 'x' | 'y';

export interface WindowDrag {
  /** Attach to the window's outermost element — resizing measures it. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the header's onPointerDown. */
  startDrag: (e: React.PointerEvent) => void;
  /** Attach to a resize handle's onPointerDown. Omitted axis resizes both. */
  startResize: (e: React.PointerEvent, axis?: ResizeAxis) => void;
}

export function useWindowDrag(
  position: ChatPosition,
  onMove: (position: ChatPosition) => void,
  onResize: (size: ChatSize) => void,
): WindowDrag {
  /** Grab offset while dragging: pointer minus window origin. Null = not dragging. */
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
  /** Grab offset while resizing: pointer minus the size at drag start. Null = not resizing. */
  const [resizeDrag, setResizeDrag] = useState<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    axis: ResizeAxis;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Listeners on the window, not on the header: bringing the window to the front
  // re-orders it in the DOM, which would drop a pointer capture held by the header.
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      onMove(
        clampChatPosition(
          { x: e.clientX - drag.dx, y: e.clientY - drag.dy },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const end = () => setDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [drag, onMove]);

  // Same pattern as the drag listener above, for the resize handle.
  useEffect(() => {
    if (!resizeDrag) return;
    const move = (e: PointerEvent) => {
      onResize(
        clampChatSize(
          {
            // An axis the gesture does not own keeps its starting value, rather
            // than being recomputed from a pointer delta it should not read.
            width:
              resizeDrag.axis === 'y'
                ? resizeDrag.startW
                : resizeDrag.startW + (e.clientX - resizeDrag.startX),
            height:
              resizeDrag.axis === 'x'
                ? resizeDrag.startH
                : resizeDrag.startH + (e.clientY - resizeDrag.startY),
          },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const end = () => setResizeDrag(null);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [resizeDrag, onResize]);

  const startDrag = (e: React.PointerEvent) => {
    // Buttons in the header (✕, dropdowns) are controls, not a handle.
    if ((e.target as HTMLElement).closest('button')) return;
    setDrag({ dx: e.clientX - position.x, dy: e.clientY - position.y });
  };

  const startResize = (e: React.PointerEvent, axis: ResizeAxis = 'both') => {
    e.stopPropagation();
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    setResizeDrag({
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
      axis,
    });
  };

  return { panelRef, startDrag, startResize };
}
