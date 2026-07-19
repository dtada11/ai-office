import { useEffect, useRef } from 'react';

import {
  FLOW_ACTIVE_BORDER,
  FLOW_ACTIVE_FILL,
  FLOW_LABEL_COLOR,
  FLOW_LEAD_BORDER,
  FLOW_LEAD_FILL,
  FLOW_NODE_BORDER,
  FLOW_NODE_FILL,
  FLOW_PERM_BORDER,
  FLOW_PERM_FILL,
  FLOW_WIRE_COLOR,
  flowRgb,
  flowRgba,
} from '../../constants.js';
import type { FlowPacket } from './dashboardModel.js';
import { easeInOut, layoutFlowNodes, packetProgress } from './dashboardModel.js';

// ── 팀 흐름 캔버스 (대시보드 탭) ───────────────────────────────────────────
/** RGB triples, not colours: the packet trail builds gradients from them. */
const FLOW_OUT_RGB = '116, 111, 255';
const FLOW_BACK_RGB = '137, 209, 133';
/** Canvas text. The pixel face carries no Hangul (see index.css), so Korean
 *  labels fall through to the system sans either way — naming it here keeps the
 *  Latin/digit glyphs consistent with the rest of the UI. */
const FLOW_LEAD_FONT = '700 13px "FS Pixel Sans", sans-serif';
const FLOW_STAFF_FONT = '12px "FS Pixel Sans", sans-serif';

/** 팀 흐름 — the lead in the middle, staff on a ring, and a packet crossing the
 *  wire each time work is delegated (배분) or a result is collected (수거).
 *
 *  Ported from the standalone dashboard's #flowCanvas, redrawn square: this is
 *  a pixel-art office, so nodes and packets are rectangles with hard 2px
 *  borders rather than the original's circles.
 *
 *  Lifecycle notes, because this is the one animated thing in the window:
 *   - the rAF loop is started in an effect and cancelled in its cleanup, so
 *     switching to the 회의록 tab (which unmounts this component) stops it. The
 *     loop cannot outlive the canvas.
 *   - packets and the barrier arrive as refs, not props, so a packet in flight
 *     never re-renders React — only the canvas repaints.
 *   - `staff` DOES change by prop, so it is mirrored into a ref that is
 *     rewritten on every render; the loop reads the ref, which means the effect
 *     never has to restart (and never drops a frame) when the roster changes.
 */

export interface FlowStaff {
  agentId: number;
  name: string;
  active: boolean;
  perm: boolean;
}

interface FlowCanvasProps {
  staff: FlowStaff[];
  packetsRef: React.RefObject<FlowPacket[]>;
  barrierRef: React.RefObject<number>;
}

export function FlowCanvas({ staff, packetsRef, barrierRef }: FlowCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const staffRef = useRef(staff);
  staffRef.current = staff;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let frame = 0;

    const draw = () => {
      frame = requestAnimationFrame(draw);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w < 4 || h < 4) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const now = Date.now();
      const nodes = layoutFlowNodes(staffRef.current, w, h);
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const lead = nodes[0];

      // Wires first, so everything else sits on top of them.
      ctx.strokeStyle = FLOW_WIRE_COLOR;
      ctx.lineWidth = 2;
      for (const n of nodes) {
        if (n.id === 'LEAD') continue;
        ctx.beginPath();
        ctx.moveTo(lead.x, lead.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }

      // The barrier ripple: every teammate's result is in, the lead may proceed.
      const barrier = barrierRef.current ?? 0;
      if (barrier && now - barrier < 900) {
        const p = (now - barrier) / 900;
        const size = 26 + p * 44;
        ctx.strokeStyle = flowRgba(FLOW_BACK_RGB, 0.5 * (1 - p));
        ctx.lineWidth = 2;
        ctx.strokeRect(lead.x - size, lead.y - size, size * 2, size * 2);
      }

      // Packets in flight. Arrived ones are dropped here rather than on a
      // timer, so nothing accumulates while the tab is hidden and the loop is
      // not running.
      const packets = packetsRef.current ?? [];
      const stillFlying: FlowPacket[] = [];
      for (const pk of packets) {
        const raw = packetProgress(pk, now);
        if (raw >= 1) continue;
        const from = byId.get(pk.from) ?? lead;
        const to = byId.get(pk.to) ?? lead;
        const e = easeInOut(Math.max(0, raw));
        const e0 = easeInOut(Math.max(0, raw - 0.1));
        const x = from.x + (to.x - from.x) * e;
        const y = from.y + (to.y - from.y) * e;
        const x0 = from.x + (to.x - from.x) * e0;
        const y0 = from.y + (to.y - from.y) * e0;
        const col = pk.kind === 'out' ? FLOW_OUT_RGB : FLOW_BACK_RGB;
        const grad = ctx.createLinearGradient(x0, y0, x, y);
        grad.addColorStop(0, flowRgba(col, 0));
        grad.addColorStop(1, flowRgba(col, 0.85));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = flowRgb(col);
        ctx.fillRect(Math.round(x) - 3, Math.round(y) - 3, 6, 6);
        stillFlying.push(pk);
      }
      if (packetsRef.current) packetsRef.current = stillFlying;

      // Nodes on top.
      for (const n of nodes) {
        const isLead = n.id === 'LEAD';
        const half = isLead ? 20 : 15;
        ctx.fillStyle = isLead
          ? FLOW_LEAD_FILL
          : n.perm
            ? FLOW_PERM_FILL
            : n.active
              ? FLOW_ACTIVE_FILL
              : FLOW_NODE_FILL;
        ctx.fillRect(n.x - half, n.y - half, half * 2, half * 2);
        ctx.strokeStyle = isLead
          ? FLOW_LEAD_BORDER
          : n.perm
            ? FLOW_PERM_BORDER
            : n.active
              ? FLOW_ACTIVE_BORDER
              : FLOW_NODE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(n.x - half, n.y - half, half * 2, half * 2);

        ctx.textAlign = 'center';
        ctx.fillStyle = FLOW_LABEL_COLOR;
        if (isLead) {
          ctx.textBaseline = 'middle';
          ctx.font = FLOW_LEAD_FONT;
          ctx.fillText('팀장', n.x, n.y + 1);
        } else {
          // Name on the far side from the lead, so a node sitting directly
          // above the centre does not write its label into the gap between the
          // two boxes — the panel is short and that gap is only ~30px.
          const above = n.y < lead.y;
          ctx.textBaseline = above ? 'bottom' : 'top';
          ctx.font = FLOW_STAFF_FONT;
          ctx.fillText(n.label, n.x, n.y + (above ? -half - 5 : half + 5));
        }
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [packetsRef, barrierRef]);

  return (
    <canvas ref={canvasRef} className="block w-full h-full" data-testid="dashboard-flow-canvas" />
  );
}
