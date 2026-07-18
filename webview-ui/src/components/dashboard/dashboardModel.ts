/** Pure helpers behind the dashboard tab: turning the office's broadcast
 *  messages into feed rows and flow packets, and turning the state the webview
 *  already holds into the rows the 직원 panel draws.
 *
 *  Kept free of React and the DOM for the same reason boardEntries.ts is — the
 *  webview tests run in plain Node, and tsconfig.node.json compiles test/
 *  without src/, so anything a test reaches must not drag `window` in with it.
 *
 *  The mapping below is ported from the standalone dashboard app
 *  (ai-office-dashboard/dashboard.html), which read the same /ws broadcast.
 */

/** The broadcast fields this file reads. Spelled out as optionals rather than
 *  imported from core/messages so this module stays a leaf. */
export interface DashboardMessage {
  type: string;
  id?: number;
  agentId?: number;
  toolId?: string;
  toolName?: string;
  status?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
  kind?: string;
  text?: string;
  title?: string;
  input?: string;
  level?: string;
  stream?: string;
  data?: string;
  exitCode?: number;
  error?: string;
  teamName?: string;
}

/** Which colour a feed row gets. Named after what happened, not after a colour,
 *  so restyling the panel never means re-deciding what each event is. */
export type FeedClass = 'tool' | 'done' | 'perm' | 'result' | 'system' | 'err' | 'life' | 'board';

export interface FeedRow {
  /** Monotonic, assigned by the hook — used as the React key, because two rows
   *  can share a millisecond. */
  seq: number;
  at: number;
  cls: FeedClass;
  tag: string;
  who: string;
  text: string;
}

/** How many rows the feed keeps. Beyond this the oldest are dropped: this is a
 *  live view, not a log file. */
export const FEED_CAP = 300;

/** Collapse whitespace and cut to a length that fits one feed line. */
export function short(s: string | undefined, n = 90): string {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

/** Wall-clock HH:MM:SS, which is what a live feed is read by.
 *
 *  Formatted by hand rather than through toLocaleTimeString: the Korean locale
 *  renders "0시 45분 7초", which is both variable-width and long enough to wrap
 *  the feed's time column onto two lines. Every row in a live feed has to be
 *  one line tall. */
export function hhmmss(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** One broadcast → one feed row, or null when the message is not feed-worthy
 *  (assets, sprites, settings, layout — the bulk of the traffic).
 *
 *  `labelOf` names the agent; it is passed in rather than looked up here so
 *  this stays pure and the caller keeps a single source of names (the roster
 *  the webview already has). */
export function feedRowFor(
  msg: DashboardMessage,
  labelOf: (agentId: number | undefined) => string,
  at: number,
): FeedRow | null {
  const row = (cls: FeedClass, tag: string, who: string, text: string): FeedRow => ({
    seq: 0,
    at,
    cls,
    tag,
    who,
    text,
  });

  switch (msg.type) {
    case 'agentCreated':
      return row(
        'life',
        'JOIN',
        labelOf(msg.id),
        msg.teamName ? `세션 등장 · 팀 ${msg.teamName}` : '세션 등장',
      );
    case 'agentClosed':
      return row('life', 'EXIT', labelOf(msg.id), '세션 종료');
    case 'agentToolStart': {
      const name = msg.toolName || msg.status || 'tool';
      const suffix = `${msg.permissionActive ? ' · 결재중' : ''}${msg.runInBackground ? ' · bg' : ''}`;
      return row('tool', 'TOOL▶', labelOf(msg.id), short(name, 60) + suffix);
    }
    case 'agentToolDone':
      return row('done', 'TOOL✓', labelOf(msg.id), '도구 완료');
    case 'agentPermissionRequest':
      return row(
        'perm',
        '결재?',
        labelOf(msg.agentId),
        `${msg.toolName ?? ''} — ${short(msg.title || msg.input, 70)}`,
      );
    case 'agentPermissionResolved':
      return row('done', '결재✓', labelOf(msg.agentId), '결재 해소');
    case 'agentEvent': {
      // Empty streaming chunks are noise, not events.
      if (msg.kind === 'text' && !String(msg.text ?? '').trim()) return null;
      const map: Record<string, [FeedClass, string]> = {
        user: ['life', '▷사용자'],
        text: ['system', '말'],
        result: ['result', '결과'],
        system: ['system', '시스템'],
        tool: ['tool', '도구'],
      };
      const [cls, tag] = map[msg.kind ?? ''] ?? (['life', msg.kind ?? '?'] as [FeedClass, string]);
      return row(cls, tag, labelOf(msg.agentId), short(msg.text, 140));
    }
    case 'shellOutput':
      return row(
        msg.stream === 'stderr' ? 'err' : 'life',
        msg.stream === 'stderr' ? 'SH!' : 'SH',
        'shell',
        short(msg.data, 100),
      );
    case 'shellExit':
      return row(
        msg.exitCode ? 'err' : 'done',
        'SH⏹',
        'shell',
        `종료 코드 ${msg.exitCode ?? '?'}${msg.error ? ' · ' + msg.error : ''}`,
      );
    case 'officeNotice':
      return row(
        msg.level === 'error' ? 'err' : 'system',
        msg.level === 'error' ? '경고' : '알림',
        'office',
        short(msg.text, 140),
      );
    case 'boardUpdate':
      // The minutes themselves live in the other tab; this line is only the
      // "something was written" beat, which is what a feed is for.
      return row('board', '회의록', 'BOARD.md', `[${msg.kind ?? ''}] ${short(msg.text, 100)}`);
    default:
      return null;
  }
}

/** Append with a cap, oldest dropped first. Returns a new array — callers keep
 *  it in React state. */
export function pushCapped<T>(rows: T[], row: T, cap = FEED_CAP): T[] {
  const next = rows.length >= cap ? rows.slice(rows.length - cap + 1) : rows.slice();
  next.push(row);
  return next;
}

// ── 팀 흐름 (배분 → 수거) ───────────────────────────────────────────────────

/** Either a staff member's agentId, or the lead at the centre. */
export type FlowNodeId = number | 'LEAD';

export interface FlowPacket {
  from: FlowNodeId;
  to: FlowNodeId;
  /** out = 배분 (lead → staff), back = 수거 (staff → lead). */
  kind: 'out' | 'back';
  born: number;
}

/** How long one packet takes to cross, in ms. */
export const PACKET_MS = 1300;

/** Which packet, if any, a broadcast means.
 *
 *  Basis (unchanged from the standalone dashboard): the office broadcasts
 *  `agentEvent{kind:'system', text:'팀장 지시…'}` to the staff member being
 *  delegated to, and a `result` is that member's output coming back. */
export function flowPacketFor(msg: DashboardMessage, at: number): FlowPacket | null {
  if (msg.type !== 'agentEvent' || msg.agentId === undefined) return null;
  if (msg.kind === 'system' && /팀장\s*지시/.test(msg.text ?? '')) {
    return { from: 'LEAD', to: msg.agentId, kind: 'out', born: at };
  }
  if (msg.kind === 'result') {
    return { from: msg.agentId, to: 'LEAD', kind: 'back', born: at };
  }
  return null;
}

export interface FlowNode {
  id: FlowNodeId;
  x: number;
  y: number;
  label: string;
  active: boolean;
  perm: boolean;
}

/** Lead at the centre, staff on a ring around it. Pure geometry so the layout
 *  is decidable without a canvas. */
export function layoutFlowNodes(
  staff: Array<{ agentId: number; name: string; active: boolean; perm: boolean }>,
  width: number,
  height: number,
): FlowNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const nodes: FlowNode[] = [
    { id: 'LEAD', x: cx, y: cy, label: '팀장', active: false, perm: false },
  ];
  const r = Math.max(48, Math.min(width, height) * 0.34);
  staff.forEach((s, i) => {
    const ang = -Math.PI / 2 + (staff.length === 1 ? 0 : (i / staff.length) * Math.PI * 2);
    nodes.push({
      id: s.agentId,
      x: cx + Math.cos(ang) * r,
      y: cy + Math.sin(ang) * r,
      label: s.name.length > 7 ? s.name.slice(0, 7) : s.name,
      active: s.active,
      perm: s.perm,
    });
  });
  return nodes;
}

/** Eased 0→1 progress of a packet, and whether it has arrived. */
export function packetProgress(packet: FlowPacket, at: number): number {
  return (at - packet.born) / PACKET_MS;
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// ── 직원 패널 ───────────────────────────────────────────────────────────────

/** The roster fields this panel reads. Structural, so an EmployeeInfo passes
 *  unchanged without importing the hook module that declares it. */
export interface DashboardEmployee {
  agentId: number;
  name: string;
  role: 'lead' | 'staff';
  duty: 'on' | 'clockingOut' | 'off';
  roleLabel?: string;
  model?: string;
  cwd: string;
  contextTokens?: number;
  contextLimit?: number;
  costUsd?: number;
}

/** The open-tool fields this panel reads (structurally a ToolActivity). */
export interface DashboardTool {
  toolId: string;
  status: string;
  done: boolean;
  permissionWait?: boolean;
}

/** A tool call is called out once it has been open this long — the signal the
 *  original panel existed for (something is stuck behind a prompt or a hang). */
export const STUCK_SECONDS = 30;

export interface AgentToolRow {
  toolId: string;
  name: string;
  seconds: number;
  stuck: boolean;
}

export interface AgentRow {
  agentId: number;
  name: string;
  roleText: string;
  isLead: boolean;
  statusKind: 'perm' | 'active' | 'waiting' | 'idle';
  statusText: string;
  model: string;
  context: string;
  cost: string;
  started: number;
  done: number;
  open: number;
  cwd: string;
  tools: AgentToolRow[];
}

export interface AgentRowsInput {
  employees: DashboardEmployee[];
  /** agentId → open/closed tool calls, as the webview already tracks them. */
  tools: Record<number, DashboardTool[]>;
  /** agentId → pending approval count. */
  permissionCounts: Record<number, number>;
  /** agentId → whether a turn is in progress. */
  busy: Record<number, boolean>;
  /** agentId → last reported status ('waiting' etc.); 'active' is absent by
   *  design in the webview's state, so absence is not idleness. */
  statuses: Record<number, string>;
  /** agentId → { model, contextTokens, contextLimit } from token usage. */
  tokens: Record<number, { model?: string; contextTokens?: number; contextLimit?: number }>;
  /** agentId → cumulative tool starts/completions this session. */
  counters: Record<number, { started: number; done: number }>;
  /** toolId → when it started, so an open call can show its age. */
  toolStartedAt: Record<string, number>;
  now: number;
  /** Resolves a tool call's display name from its status line. */
  toolNameOf: (status: string) => string;
}

/** k-suffixed token counts, the way the token gauge already reads. */
function contextText(tokens: number | undefined, limit: number | undefined): string {
  if (limit) return `${Math.round((tokens ?? 0) / 1000)}k / ${Math.round(limit / 1000)}k`;
  if (tokens) return `${Math.round(tokens / 1000)}k`;
  return '—';
}

/** Everyone currently in the office, leads first, with what they are doing.
 *  Off-duty employees are left out: this panel is about live activity, and the
 *  staff list is where the full roster lives. */
export function buildAgentRows(input: AgentRowsInput): AgentRow[] {
  const live = input.employees.filter((e) => e.duty !== 'off');
  const sorted = [...live].sort(
    (a, b) => (a.role === 'lead' ? 0 : 1) - (b.role === 'lead' ? 0 : 1) || a.agentId - b.agentId,
  );

  return sorted.map((e) => {
    const tools = input.tools[e.agentId] ?? [];
    const open = tools.filter((t) => !t.done);
    const perm = (input.permissionCounts[e.agentId] ?? 0) > 0;
    const busy = input.busy[e.agentId] === true || open.length > 0;
    const waiting = input.statuses[e.agentId] === 'waiting';

    const statusKind: AgentRow['statusKind'] = perm
      ? 'perm'
      : busy
        ? 'active'
        : waiting
          ? 'waiting'
          : 'idle';
    const statusText = { perm: '결재 대기', active: '작업 중', waiting: '대기', idle: '—' }[
      statusKind
    ];

    const token = input.tokens[e.agentId];
    const counter = input.counters[e.agentId] ?? { started: 0, done: 0 };

    return {
      agentId: e.agentId,
      name: e.roleLabel || e.name || `#${e.agentId}`,
      roleText: e.role === 'lead' ? '팀장' : '팀원',
      isLead: e.role === 'lead',
      statusKind,
      statusText,
      model: token?.model || e.model || '—',
      context: contextText(
        token?.contextTokens ?? e.contextTokens,
        token?.contextLimit ?? e.contextLimit,
      ),
      cost: e.costUsd ? `$${e.costUsd.toFixed(4)}` : '—',
      started: counter.started,
      done: counter.done,
      open: open.length,
      cwd: e.cwd || '—',
      tools: open.map((t) => {
        const startedAt = input.toolStartedAt[t.toolId];
        const seconds = startedAt ? Math.max(0, Math.floor((input.now - startedAt) / 1000)) : 0;
        return {
          toolId: t.toolId,
          name: input.toolNameOf(t.status),
          seconds,
          stuck: seconds >= STUCK_SECONDS,
        };
      }),
    };
  });
}

/** Who to draw on the flow ring: the live staff, with their current state. */
export function flowStaff(
  rows: AgentRow[],
): Array<{ agentId: number; name: string; active: boolean; perm: boolean }> {
  return rows
    .filter((r) => !r.isLead)
    .map((r) => ({
      agentId: r.agentId,
      name: r.name,
      active: r.statusKind === 'active',
      perm: r.statusKind === 'perm',
    }));
}
