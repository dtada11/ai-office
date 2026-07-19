import { useMemo } from 'react';

import { extractToolName } from '../../office/toolUtils.js';
import { Button } from '../ui/Button.js';
import type { AgentRow, DashboardEmployee, DashboardTool, FeedClass } from './dashboardModel.js';
import { buildAgentRows, flowStaff, hhmmss } from './dashboardModel.js';
import { FlowCanvas } from './FlowCanvas.js';
import type { OfficeFeed } from './useOfficeFeed.js';

/** The dashboard tab: 직원 / 라이브 반응 피드 / 팀 흐름, brought in from the
 *  standalone dashboard app so the office does not need a second window open
 *  beside it.
 *
 *  Deliberately absent: the original's connection pill and uptime. The office
 *  webview is served by the very server it would be reporting on, so "연결 안 됨"
 *  is not a state it can be in — the indicator would be permanent decoration.
 *
 *  Every number here except the feed comes from state the webview already had
 *  (see the props below); only the feed, the tool counters, and the tool start
 *  times are new (useOfficeFeed).
 */

export interface DashboardTabProps {
  employees: DashboardEmployee[];
  agentTools: Record<number, DashboardTool[]>;
  permissionCounts: Record<number, number>;
  busy: Record<number, boolean>;
  agentStatuses: Record<number, string>;
  agentTokenInfo: Record<number, { model?: string; contextTokens?: number; contextLimit?: number }>;
  feed: OfficeFeed;
}

const FEED_TAG_COLOR: Record<FeedClass, string> = {
  tool: 'text-status-active',
  done: 'text-status-success',
  perm: 'text-status-permission',
  result: 'text-status-success',
  system: 'text-accent-bright',
  err: 'text-status-error',
  life: 'text-text-muted',
  board: 'text-warning',
  // Brighter than 'board', and bold: a plan change moves the ground under every
  // later 배분, so it has to be findable when scrolling back through the feed.
  plan: 'text-warning font-bold',
};

function Panel({
  title,
  count,
  actions,
  children,
  testId,
  bodyClass = 'overflow-y-auto',
}: {
  title: string;
  count?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId: string;
  bodyClass?: string;
}) {
  return (
    <div className="flex flex-col min-h-0 border-2 border-border bg-bg-dark" data-testid={testId}>
      <div className="flex items-center gap-6 px-6 py-4 border-b-2 border-border shrink-0">
        <span className="text-2xs text-text-muted whitespace-nowrap">{title}</span>
        {count && <span className="text-2xs text-text-muted font-mono">{count}</span>}
        {/* Controls sit next to the title rather than at the far right: the
            right edge of this window is where the token gauge floats, and
            buttons parked under it cannot be clicked. */}
        {actions}
        <div className="flex-1" />
      </div>
      <div className={`flex-1 min-h-0 ${bodyClass}`}>{children}</div>
    </div>
  );
}

function AgentCard({ row }: { row: AgentRow }) {
  const dot =
    row.statusKind === 'perm'
      ? 'bg-status-permission'
      : row.statusKind === 'active'
        ? 'bg-status-success'
        : row.statusKind === 'waiting'
          ? 'bg-warning'
          : 'bg-text-muted';
  return (
    <div
      className={`border-2 ${row.statusKind === 'perm' ? 'border-status-permission' : 'border-border'} bg-bg-thumb p-6 mb-6`}
      data-testid="dashboard-agent-card"
    >
      <div className="flex items-center gap-6">
        <span className="text-xs">{row.name}</span>
        <span
          className={`text-2xs px-4 border-2 ${row.isLead ? 'border-accent-bright text-accent-bright' : 'border-border text-text-muted'}`}
        >
          {row.roleText}
        </span>
        <div className="flex-1" />
        <span className="flex items-center gap-4 text-2xs text-text-muted whitespace-nowrap">
          <span className={`w-8 h-8 ${dot}`} />
          {row.statusText}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-[auto_1fr] gap-x-8 gap-y-1 text-2xs">
        <span className="text-text-muted">모델</span>
        <span className="font-mono truncate">{row.model}</span>
        <span className="text-text-muted">컨텍스트</span>
        <span className="font-mono">{row.context}</span>
        <span className="text-text-muted">비용</span>
        <span className="font-mono">{row.cost}</span>
        <span className="text-text-muted">도구</span>
        <span className="font-mono">
          시작 {row.started} · 완료 {row.done} · 진행 {row.open}
        </span>
        <span className="text-text-muted">폴더</span>
        <span className="font-mono truncate" title={row.cwd}>
          {row.cwd}
        </span>
      </div>
      {row.tools.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-4">
          {row.tools.map((t) => (
            <span
              key={t.toolId}
              className={`text-2xs font-mono px-4 py-1 border-2 ${t.stuck ? 'border-status-error text-status-error' : 'border-border text-text-muted'}`}
            >
              {t.name} · {t.seconds}s{t.stuck ? ' ⚠' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function DashboardTab({
  employees,
  agentTools,
  permissionCounts,
  busy,
  agentStatuses,
  agentTokenInfo,
  feed,
}: DashboardTabProps) {
  const rows = useMemo(
    () =>
      buildAgentRows({
        employees,
        tools: agentTools,
        permissionCounts,
        busy,
        statuses: agentStatuses,
        tokens: agentTokenInfo,
        counters: feed.counters,
        toolStartedAt: feed.toolStartedAt,
        now: feed.now,
        toolNameOf: (status) => extractToolName(status) ?? 'tool',
      }),
    [
      employees,
      agentTools,
      permissionCounts,
      busy,
      agentStatuses,
      agentTokenInfo,
      feed.counters,
      feed.toolStartedAt,
      feed.now,
    ],
  );

  const staff = useMemo(() => flowStaff(rows), [rows]);
  const activeCount = rows.filter((r) => r.statusKind === 'active').length;

  return (
    <div className="flex-1 min-h-0 grid grid-cols-2 gap-6" data-testid="dashboard-tab">
      <Panel
        title="직원"
        count={rows.length ? `${activeCount} 활성 / ${rows.length}` : ''}
        testId="dashboard-agents"
      >
        {rows.length === 0 ? (
          <div
            className="text-xs text-text-muted p-10 text-center"
            data-testid="dashboard-agents-empty"
          >
            아직 활동하는 직원이 없습니다.
          </div>
        ) : (
          <div className="p-6 pb-0">
            {rows.map((r) => (
              <AgentCard key={r.agentId} row={r} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid grid-rows-[1fr_240px] gap-6 min-h-0">
        <Panel
          title="라이브 반응 피드"
          count={feed.rows.length ? `${feed.rows.length}건` : ''}
          testId="dashboard-feed"
          actions={
            <div className="flex items-center gap-4 shrink-0">
              <Button
                variant={feed.paused ? 'active' : 'default'}
                size="sm"
                onClick={feed.togglePause}
                title="피드를 멈추고 읽기"
                data-testid="dashboard-feed-pause"
              >
                {feed.paused ? `피드 재개 (${feed.bufferedCount})` : '피드 일시정지'}
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={feed.clear}
                title="피드 비우기"
                data-testid="dashboard-feed-clear"
              >
                피드 지우기
              </Button>
            </div>
          }
        >
          {feed.rows.length === 0 ? (
            <div
              className="text-xs text-text-muted p-10 text-center"
              data-testid="dashboard-feed-empty"
            >
              이벤트 대기 중…
            </div>
          ) : (
            // Newest first: the bottom of a live feed is the part nobody reads.
            [...feed.rows].reverse().map((row) => (
              <div
                key={row.seq}
                // Time column wide enough for a whole HH:MM:SS at this size —
                // narrower and the clock runs into the name beside it.
                className="grid grid-cols-[78px_104px_1fr] gap-6 px-6 py-2 border-b border-bg-thumb text-2xs"
                data-testid="dashboard-feed-row"
              >
                <span className="text-text-muted font-mono">{hhmmss(row.at)}</span>
                <span className="text-text-muted font-mono truncate" title={row.who}>
                  {row.who}
                </span>
                <span className="min-w-0 break-words">
                  <span className={`font-mono ${FEED_TAG_COLOR[row.cls]}`}>{row.tag}</span>{' '}
                  {row.text}
                </span>
              </div>
            ))
          )}
        </Panel>

        <Panel
          title="팀 흐름 — 보드에 계획 → 배분 → 수거 (기다리지 않음)"
          testId="dashboard-flow"
          bodyClass="overflow-hidden"
        >
          {/* With nobody to draw a wire to, the diagram is a lone box under a
              sentence — so it is the sentence alone, and the canvas (with its
              animation frame) is not mounted at all. */}
          {staff.length === 0 ? (
            <div
              className="w-full h-full flex items-center justify-center text-2xs text-text-muted px-10 text-center"
              data-testid="dashboard-flow-empty"
            >
              팀장이 보드에 계획을 적고 팀원에게 배분하면, 여기서 오가는 게 보입니다.
            </div>
          ) : (
            <FlowCanvas staff={staff} packetsRef={feed.packetsRef} />
          )}
        </Panel>
      </div>
    </div>
  );
}
