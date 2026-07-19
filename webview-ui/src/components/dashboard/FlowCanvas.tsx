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
/** 계획 갱신 (팀장 → 보드). Amber, so the one event that moves everyone's basis
 *  never reads as just another 배분. */
const FLOW_PLAN_RGB = '242, 163, 60';
/** Canvas text. The pixel face carries no Hangul (see index.css), so Korean
 *  labels fall through to the system sans either way — naming it here keeps the
 *  Latin/digit glyphs consistent with the rest of the UI. */
const FLOW_LEAD_FONT = '700 13px "FS Pixel Sans", sans-serif';
const FLOW_STAFF_FONT = '12px "FS Pixel Sans", sans-serif';

/** 팀 흐름 — the board on top, the lead under it, the staff along the bottom,
 *  and a packet crossing each time the plan is rewritten (계획), work is handed
 *  out (배분), or a result is taken back (수거).
 *
 *  The arrangement is the lesson. The board carries the plan; the lead is the
 *  only one who edits it; every member works off it and reports back up. Read
 *  downward it is 계획 → 배분 → 작업, read upward it is 수거. An earlier version put
 *  the lead at the centre of a ring with no board drawn at all, which taught the
 *  wrong shape — that work revolves around the lead, and that the board is a
 *  side-effect rather than the thing being agreed on.
 *
 *  Ported from the standalone dashboard's #flowCanvas, redrawn square: this is
 *  a pixel-art office, so nodes and packets are rectangles with hard 2px
 *  borders rather than the original's circles.
 *
 *  Lifecycle notes, because this is the one animated thing in the window:
 *   - the rAF loop is started in an effect and cancelled in its cleanup, so
 *     switching to the 회의록 tab (which unmounts this component) stops it. The
 *     loop cannot outlive the canvas.
 *   - packets arrive as a ref, not a prop, so a packet in flight never
 *     re-renders React — only the canvas repaints.
 *   - `staff` DOES change by prop, so it is mirrored into a ref that is
 *     rewritten on every render; the loop reads the ref, which means the effect
 *     never has to restart (and never drops a frame) when the roster changes.
 */

export interface FlowStaff {
  agentId: number;
  name: string;
  active: boolean;
  perm: boolean;
  done: boolean;
}

interface FlowCanvasProps {
  staff: FlowStaff[];
  packetsRef: React.RefObject<FlowPacket[]>;
}

export function FlowCanvas({ staff, packetsRef }: FlowCanvasProps) {
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
      const board = nodes[0];
      const lead = nodes[1];
      const members = nodes.slice(2);

      // Wires first, so everything else sits on top of them.
      ctx.strokeStyle = FLOW_WIRE_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(lead.x, lead.y);
      ctx.lineTo(board.x, board.y);
      ctx.stroke();
      for (const n of members) {
        ctx.beginPath();
        ctx.moveTo(lead.x, lead.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }

      // Board → each member, dashed and dim: the reading path. Nothing animates
      // along it (a member reads the board inside its own turn, and the office
      // never sees that as an event), but leaving it undrawn would make the
      // board look like it only ever talks to the lead.
      ctx.save();
      ctx.setLineDash([3, 4]);
      ctx.strokeStyle = flowRgba(FLOW_PLAN_RGB, 0.28);
      ctx.lineWidth = 1;
      for (const n of members) {
        ctx.beginPath();
        ctx.moveTo(board.x, board.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
      ctx.restore();

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
        const col =
          pk.kind === 'plan' ? FLOW_PLAN_RGB : pk.kind === 'out' ? FLOW_OUT_RGB : FLOW_BACK_RGB;
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
        const isBoard = n.id === 'BOARD';
        const isLead = n.id === 'LEAD';
        // The board is drawn wide rather than square — it is a document, and the
        // shape says so before the label is read.
        const halfX = isBoard ? Math.min(64, w * 0.3) : isLead ? 20 : 15;
        const halfY = isBoard ? 13 : isLead ? 20 : 15;

        ctx.fillStyle = isBoard
          ? FLOW_NODE_FILL
          : isLead
            ? FLOW_LEAD_FILL
            : n.perm
              ? FLOW_PERM_FILL
              : n.active
                ? FLOW_ACTIVE_FILL
                : FLOW_NODE_FILL;
        ctx.fillRect(n.x - halfX, n.y - halfY, halfX * 2, halfY * 2);
        ctx.strokeStyle = isBoard
          ? flowRgb(FLOW_PLAN_RGB)
          : isLead
            ? FLOW_LEAD_BORDER
            : n.perm
              ? FLOW_PERM_BORDER
              : n.active
                ? FLOW_ACTIVE_BORDER
                : FLOW_NODE_BORDER;
        ctx.lineWidth = 2;
        ctx.strokeRect(n.x - halfX, n.y - halfY, halfX * 2, halfY * 2);

        // Finished but uncollected: a filled pip on the top-right corner. The
        // node itself stays idle-coloured because the member is not working —
        // what is pending is the lead picking the result up.
        if (n.done) {
          ctx.fillStyle = flowRgb(FLOW_BACK_RGB);
          ctx.fillRect(n.x + halfX - 6, n.y - halfY - 2, 8, 8);
        }

        ctx.textAlign = 'center';
        ctx.fillStyle = FLOW_LABEL_COLOR;
        if (isBoard || isLead) {
          ctx.textBaseline = 'middle';
          ctx.font = isLead ? FLOW_LEAD_FONT : FLOW_STAFF_FONT;
          ctx.fillText(n.label, n.x, n.y + 1);
        } else {
          // Members sit on the bottom row, so their names go underneath — the
          // gap to the lead above is where the 배분/수거 packets travel.
          ctx.textBaseline = 'top';
          ctx.font = FLOW_STAFF_FONT;
          ctx.fillText(n.label, n.x, n.y + halfY + 5);
        }
      }
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [packetsRef]);

  return (
    <canvas ref={canvasRef} className="block w-full h-full" data-testid="dashboard-flow-canvas" />
  );
}
