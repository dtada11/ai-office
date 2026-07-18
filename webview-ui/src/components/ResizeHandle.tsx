import type { ResizeAxis } from '../hooks/useWindowDrag.js';

/** The grab zones that resize a floating window: the right edge for width, the
 *  bottom edge for height, and the corner for both.
 *
 *  Nothing is drawn. The window's own border is the visible edge, and a mark
 *  painted on top of it reads as decoration cluttering the panel rather than as
 *  a control. The cursor is the affordance instead — it changes the moment the
 *  pointer is over a zone, which is the convention desktop windows already use
 *  and the reason edge-dragging needs no icon to be discoverable.
 *
 *  Shared by the chat and board windows so the gesture feels identical wherever
 *  it appears.
 */
interface ResizeHandleProps {
  onPointerDown: (e: React.PointerEvent, axis?: ResizeAxis) => void;
  /** Kept distinct per window so tests can target one window's grips. */
  testId: string;
}

/** Wide enough to hit without aiming, narrow enough not to swallow clicks meant
 *  for content sitting near the edge. */
const EDGE_PX = 8;
const CORNER_PX = 16;

export function ResizeHandle({ onPointerDown, testId }: ResizeHandleProps) {
  return (
    <>
      {/* Right edge — width only. Stops short of the corner so the corner zone
          below stays reachable and wins there. */}
      <div
        className="absolute top-0 right-0 cursor-ew-resize"
        style={{ width: EDGE_PX, bottom: CORNER_PX }}
        onPointerDown={(e) => onPointerDown(e, 'x')}
        title="가로 크기 조절"
        data-testid={`${testId}-x`}
      />
      {/* Bottom edge — height only. */}
      <div
        className="absolute bottom-0 left-0 cursor-ns-resize"
        style={{ height: EDGE_PX, right: CORNER_PX }}
        onPointerDown={(e) => onPointerDown(e, 'y')}
        title="세로 크기 조절"
        data-testid={`${testId}-y`}
      />
      {/* Corner — both. Larger than the edges because it is aimed at, and last
          in the DOM so it sits above the edge zones where they meet. */}
      <div
        className="absolute right-0 bottom-0 cursor-nwse-resize"
        style={{ width: CORNER_PX, height: CORNER_PX }}
        onPointerDown={(e) => onPointerDown(e, 'both')}
        title="창 크기 조절"
        data-testid={testId}
      />
    </>
  );
}
