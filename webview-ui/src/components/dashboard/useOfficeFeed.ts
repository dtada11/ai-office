import { useCallback, useEffect, useRef, useState } from 'react';

import { transport } from '../../transport/index.js';
import type { DashboardMessage, FeedRow, FlowPacket } from './dashboardModel.js';
import { feedRowFor, flowPacketFor, pushCapped } from './dashboardModel.js';

/** The one thing the dashboard tab needs that the office webview did not
 *  already keep: an ordered stream of what just happened.
 *
 *  Everything else the tab draws (roster, statuses, open tool calls, pending
 *  approvals, token usage) is read from the state useExtensionMessages already
 *  owns and is passed in as props — this hook deliberately does NOT mirror any
 *  of it. What is genuinely absent there is (a) the event stream itself, which
 *  is consumed and discarded, (b) cumulative per-employee tool counters, and
 *  (c) when each open tool call started. Those three live here.
 *
 *  Incoming messages are written to refs and flushed into React state on a
 *  timer, the same 4Hz the standalone dashboard rendered at. A burst of tool
 *  events therefore costs one render, not one per message — and while the
 *  minutes tab is showing (`live === false`) it costs zero renders, because
 *  the timer is not running at all.
 */

export interface AgentCounters {
  started: number;
  done: number;
}

export interface OfficeFeed {
  /** Newest last. Render reversed for newest-first. */
  rows: FeedRow[];
  counters: Record<number, AgentCounters>;
  toolStartedAt: Record<string, number>;
  /** Snapshot clock, so elapsed times tick without each row holding a timer. */
  now: number;
  paused: boolean;
  /** How many rows have arrived but are held back by the pause. */
  bufferedCount: number;
  togglePause: () => void;
  clear: () => void;
  /** Live packet list for the flow canvas. A ref, not state: the canvas reads
   *  it every animation frame and must not re-render the tab to do so. */
  packetsRef: React.RefObject<FlowPacket[]>;
  /** When the last 수거 landed, for the barrier ripple. Same reasoning. */
  barrierRef: React.RefObject<number>;
}

/** Keep at most this many packets in flight; a burst of collects should not
 *  grow the array without bound. */
const PACKET_CAP = 40;

export function useOfficeFeed(
  live: boolean,
  labelOf: (agentId: number | undefined) => string,
): OfficeFeed {
  const rowsRef = useRef<FeedRow[]>([]);
  const countersRef = useRef<Record<number, AgentCounters>>({});
  const toolStartedAtRef = useRef<Record<string, number>>({});
  const packetsRef = useRef<FlowPacket[]>([]);
  const barrierRef = useRef<number>(0);
  const seqRef = useRef(0);

  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const [snapshot, setSnapshot] = useState<{
    rows: FeedRow[];
    counters: Record<number, AgentCounters>;
    toolStartedAt: Record<string, number>;
    now: number;
    flushedSeq: number;
    // Lazy: reading the clock during render is impure, and the first flush
    // below overwrites this before anything is drawn anyway.
  }>(() => ({ rows: [], counters: {}, toolStartedAt: {}, now: Date.now(), flushedSeq: 0 }));

  // Names come from the caller's roster (the one useExtensionMessages already
  // owns) — this hook holds no copy of it. Through a ref because the subscribe
  // effect below runs once: a plain closure over `labelOf` would freeze the
  // roster as it was at mount and label every later row `#3`.
  const labelRef = useRef(labelOf);
  labelRef.current = labelOf;

  useEffect(() => {
    const off = transport.onMessage((raw) => {
      const msg = raw as unknown as DashboardMessage;
      const at = Date.now();

      // Counters and tool timings: cheap bookkeeping the webview drops today.
      if (msg.type === 'agentToolStart' && msg.id !== undefined && msg.toolId) {
        const c = countersRef.current[msg.id] ?? { started: 0, done: 0 };
        countersRef.current[msg.id] = { ...c, started: c.started + 1 };
        toolStartedAtRef.current[msg.toolId] = at;
      } else if (msg.type === 'agentToolDone' && msg.id !== undefined) {
        const c = countersRef.current[msg.id] ?? { started: 0, done: 0 };
        countersRef.current[msg.id] = { ...c, done: c.done + 1 };
        if (msg.toolId) delete toolStartedAtRef.current[msg.toolId];
      }

      const packet = flowPacketFor(msg, at);
      if (packet) {
        packetsRef.current.push(packet);
        if (packetsRef.current.length > PACKET_CAP) packetsRef.current.shift();
        if (packet.kind === 'back') barrierRef.current = at;
      }

      const row = feedRowFor(msg, labelRef.current, at);
      if (row) {
        seqRef.current += 1;
        rowsRef.current = pushCapped(rowsRef.current, { ...row, seq: seqRef.current });
      }
    });
    return off;
  }, []);

  // The flush timer only exists while the tab is on screen. Paused freezes the
  // rows but keeps the clock, so open-tool ages still tick under a paused feed.
  useEffect(() => {
    if (!live) return;
    const flush = () => {
      setSnapshot((prev) => ({
        rows: pausedRef.current ? prev.rows : rowsRef.current,
        counters: { ...countersRef.current },
        toolStartedAt: { ...toolStartedAtRef.current },
        now: Date.now(),
        flushedSeq: pausedRef.current ? prev.flushedSeq : seqRef.current,
      }));
    };
    flush();
    const t = setInterval(flush, 250);
    return () => clearInterval(t);
  }, [live]);

  const togglePause = useCallback(() => setPaused((v) => !v), []);

  const clear = useCallback(() => {
    rowsRef.current = [];
    setSnapshot((prev) => ({ ...prev, rows: [], flushedSeq: seqRef.current }));
  }, []);

  return {
    rows: snapshot.rows,
    counters: snapshot.counters,
    toolStartedAt: snapshot.toolStartedAt,
    now: snapshot.now,
    paused,
    bufferedCount: Math.max(0, seqRef.current - snapshot.flushedSeq),
    togglePause,
    clear,
    packetsRef,
    barrierRef,
  };
}
