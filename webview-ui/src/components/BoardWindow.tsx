import { useCallback, useEffect, useRef, useState } from 'react';

import type { EmployeeInfo } from '../hooks/useExtensionMessages.js';
import { useWindowDrag } from '../hooks/useWindowDrag.js';
import { transport } from '../transport/index.js';
import type { BoardEntry } from './boardEntries.js';
import { parseBoard, resolveTeamRoot, splitBoard, teamOptions } from './boardEntries.js';
import type { ChatPosition, ChatSize } from './chatWindowPosition.js';
import type { DashboardTool } from './dashboard/dashboardModel.js';
import { DashboardTab } from './dashboard/DashboardTab.js';
import { useOfficeFeed } from './dashboard/useOfficeFeed.js';
import { ResizeHandle } from './ResizeHandle.js';
import { Button } from './ui/Button.js';
import { DropdownItem } from './ui/Dropdown.js';

/** The shared meeting board (BOARD.md at the team root), which the lead writes
 *  to on every delegate and collect. The office could not show it before — only
 *  the separate dashboard app could — so someone running just the office had no
 *  way to read their own team's minutes.
 *
 *  Two tabs now live in this one window: 회의록 (the minutes) and 대시보드
 *  (직원 / 라이브 피드 / 팀 흐름, absorbed from the standalone dashboard app so
 *  it no longer has to be opened beside the office).
 *
 *  Same window shell as EmployeeChat (see useWindowDrag): dragged by the
 *  header, resized from the corner, position and size owned by App so reopening
 *  puts it back where the user left it. The selected tab is owned by App too,
 *  for exactly the same reason.
 */

/** Which tab the window is showing. Owned by App. */
export type BoardTab = 'board' | 'dashboard';

/** Colour per entry kind, so 배분 (work going out) and 수거 (results coming
 *  back) are told apart at a glance while scanning, which is the one thing a
 *  reader does most on this file. Unknown kinds fall back to neutral rather
 *  than being dropped — the server owns that vocabulary, not this file. */
const KIND_STYLE: Record<string, { border: string; label: string }> = {
  배분: { border: 'border-accent-bright', label: 'text-accent-bright' },
  수거: { border: 'border-status-success', label: 'text-status-success' },
  메모: { border: 'border-border', label: 'text-text-muted' },
};
const KIND_FALLBACK = { border: 'border-border', label: 'text-text-muted' };

/** The shape of a boardContent answer. Narrowed at the use site rather than
 *  imported, matching how the other webview message consumers read the wire. */
interface BoardContentMessage {
  available: boolean;
  content: string;
  path?: string;
  teamRoot?: string;
}

/** Omitting teamRoot asks for the only team's board, which is what the server
 *  falls back to. Module-level so it is not a hook dependency. */
function requestBoard(teamRoot?: string): void {
  transport.send({ type: 'requestBoard', ...(teamRoot ? { teamRoot } : {}) });
}

interface BoardWindowProps {
  employees: EmployeeInfo[];
  position: ChatPosition;
  onMove: (position: ChatPosition) => void;
  size?: ChatSize;
  onResize: (size: ChatSize) => void;
  onClose: () => void;
  tab: BoardTab;
  onTabChange: (tab: BoardTab) => void;
  /** Everything below is state App already holds for the office — passed
   *  through to the dashboard tab so it reads the same values the rest of the
   *  webview does instead of subscribing to the broadcast a second time. */
  agentTools: Record<number, DashboardTool[]>;
  permissionCounts: Record<number, number>;
  busy: Record<number, boolean>;
  agentStatuses: Record<number, string>;
  agentTokenInfo: Record<number, { model?: string; contextTokens?: number; contextLimit?: number }>;
}

function EntryRow({ entry }: { entry: BoardEntry }) {
  const style = KIND_STYLE[entry.kind] ?? KIND_FALLBACK;

  // A line that did not parse as an entry is shown as-is, with no time or kind
  // chrome implying structure it does not have.
  if (!entry.kind) {
    return (
      <div className="text-xs text-text-muted whitespace-pre-wrap break-words mt-6">
        {entry.text}
      </div>
    );
  }

  return (
    <div className={`border-l-2 ${style.border} bg-bg-thumb pl-6 pr-4 py-4 mt-6`}>
      <div className="flex items-center gap-4">
        <span className={`text-2xs shrink-0 ${style.label}`}>[{entry.kind}]</span>
        <span className="text-2xs text-text-muted shrink-0 font-mono">{entry.time}</span>
      </div>
      <div className="mt-2 text-xs leading-loose whitespace-pre-wrap break-words">{entry.text}</div>
    </div>
  );
}

export function BoardWindow({
  employees,
  position,
  onMove,
  size,
  onResize,
  onClose,
  tab,
  onTabChange,
  agentTools,
  permissionCounts,
  busy,
  agentStatuses,
  agentTokenInfo,
}: BoardWindowProps) {
  const { panelRef, startDrag, startResize } = useWindowDrag(position, onMove, onResize);

  const teams = teamOptions(employees);
  const [pickedRoot, setPickedRoot] = useState<string | undefined>(undefined);
  const [isTeamMenuOpen, setIsTeamMenuOpen] = useState(false);
  const [board, setBoard] = useState<{ available: boolean; content: string; path?: string }>({
    available: false,
    content: '',
  });

  // Never the raw pick: a lead can be fired while this window is open, and
  // resolveTeamRoot falls back to a team that still exists.
  const activeRoot = resolveTeamRoot(teams, pickedRoot);
  const activeTeam = teams.find((t) => t.root === activeRoot);

  const logRef = useRef<HTMLDivElement>(null);

  // Names for the feed come from the roster the webview already has, so the
  // feed never has to learn who anyone is on its own.
  const labelOf = useCallback(
    (agentId: number | undefined) => {
      if (agentId === undefined) return 'office';
      const e = employees.find((x) => x.agentId === agentId);
      if (!e) return `#${agentId}`;
      return (e.roleLabel || e.name) + (e.role === 'lead' ? ' (팀장)' : '');
    },
    [employees],
  );

  // Collected for as long as the window is open, not just while the dashboard
  // tab is showing — switching to 회의록 and back must not blank the feed. The
  // `live` flag is what stops the render timer (and, downstream, the canvas)
  // while the tab is hidden.
  const feed = useOfficeFeed(tab === 'dashboard', labelOf);

  // Answers are matched to the team on screen before being shown. Switching
  // teams with a read already in flight would otherwise let the older answer
  // land last and paint the wrong team's minutes under the right team's name.
  useEffect(() => {
    const off = transport.onMessage((msg) => {
      if (msg.type === 'boardContent') {
        const content = msg as BoardContentMessage;
        if (activeRoot && content.teamRoot && content.teamRoot !== activeRoot) return;
        setBoard({ available: content.available, content: content.content, path: content.path });
      } else if (msg.type === 'boardUpdate') {
        // Re-read rather than appending the broadcast line. boardUpdate says
        // WHAT was appended but not to WHICH team's board, so with more than
        // one team an append here could file another team's entry under this
        // one. The file is small and this only runs while the window is open.
        requestBoard(activeRoot);
      }
    });
    return off;
  }, [activeRoot]);

  // Ask on open, and again whenever the team being shown changes.
  useEffect(() => {
    requestBoard(activeRoot);
  }, [activeRoot]);

  // Split before parsing: the plan carries the lead's own `##` sub-headings, and
  // the entry parser treats leading `#` as file boilerplate to drop.
  const { plan, log } = board.available ? splitBoard(board.content) : { plan: '', log: '' };
  const entries = board.available ? parseBoard(log) : [];

  // Newest entries are appended at the bottom, so land there — the last thing
  // that happened is what someone opening the minutes wants.
  //`tab` is a dependency because the log is unmounted while the dashboard is
  // showing: coming back to the minutes has to land at the bottom again, the
  // same as opening the window does.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries.length, activeRoot, tab]);

  // Three times the chat window's default width: minutes are long delegate and
  // collect lines, and at chat width every one of them wrapped several times
  // over, which is what made the board hard to scan.
  return (
    <div
      ref={panelRef}
      className={`absolute z-20 pixel-panel p-8 flex flex-col gap-6 ${size ? '' : 'w-1260 max-w-[90vw] h-[70vh]'}`}
      style={{
        left: position.x,
        top: position.y,
        ...(size ? { width: size.width, height: size.height } : {}),
      }}
      data-testid="board-window"
    >
      <div
        className="relative flex items-center gap-8 cursor-move"
        onPointerDown={startDrag}
        data-testid="board-header"
      >
        {/* The title is now the tab strip. The header keeps its own gap and the
            flexible middle below, so there is still plenty of non-button space
            to grab the window by (startDrag ignores presses on buttons). */}
        <div className="flex items-center gap-4 shrink-0">
          <Button
            variant={tab === 'board' ? 'active' : 'default'}
            size="sm"
            onClick={() => onTabChange('board')}
            title="팀의 회의록(BOARD.md)"
            data-testid="board-tab-board"
          >
            회의록
          </Button>
          <Button
            variant={tab === 'dashboard' ? 'active' : 'default'}
            size="sm"
            onClick={() => onTabChange('dashboard')}
            title="직원 · 라이브 피드 · 팀 흐름"
            data-testid="board-tab-dashboard"
          >
            대시보드
          </Button>
        </div>

        {/* The team picker and the file path describe the minutes, so they are
            only shown with them; on the dashboard tab that space becomes drag
            surface instead. */}
        {tab === 'dashboard' ? (
          <div className="flex-1 min-w-0" data-testid="board-header-spacer" />
        ) : teams.length > 1 ? (
          <div className="relative shrink-0">
            <Button
              variant="default"
              size="sm"
              onClick={() => setIsTeamMenuOpen((v) => !v)}
              title="어느 팀의 회의록을 볼지 고르기"
              data-testid="board-team-select"
            >
              {activeTeam?.name ?? '팀 선택'} ▾
            </Button>
            {isTeamMenuOpen && (
              <div className="absolute top-full left-0 pt-4 z-30">
                <div className="bg-bg border-2 border-border rounded-none shadow-pixel p-4">
                  {teams.map((t) => (
                    <DropdownItem
                      key={t.agentId}
                      onClick={() => {
                        setPickedRoot(t.root);
                        setIsTeamMenuOpen(false);
                      }}
                    >
                      {t.name}
                    </DropdownItem>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          activeTeam && (
            <span className="text-2xs text-text-muted whitespace-nowrap shrink-0">
              {activeTeam.name}
            </span>
          )
        )}

        {tab === 'board' && (
          <span
            className="flex-1 min-w-0 text-2xs text-text-muted whitespace-nowrap overflow-hidden text-ellipsis"
            title={board.path ?? activeRoot}
          >
            {board.path ?? activeRoot ?? ''}
          </span>
        )}

        <div className="flex items-center gap-4 shrink-0">
          <Button variant="default" size="sm" onClick={onClose} title="창 닫기">
            ✕
          </Button>
        </div>
      </div>

      {tab === 'board' ? (
        <div
          ref={logRef}
          className="flex-1 min-h-0 overflow-y-auto bg-bg-dark border-2 border-border rounded-none p-6 flex flex-col"
          data-testid="board-log"
        >
          {/* State above history. The plan is what is true now — a member reads
              this and nothing else to know what to build — so it sits at the top
              in full, never truncated, rather than being scrolled to through the
              log. Shown as its own markdown so the lead's 목표/제약/역할 headings
              survive. */}
          {plan && (
            <div className="mb-6 shrink-0" data-testid="board-plan">
              <div className="text-2xs text-warning font-bold mb-2">현재 계획</div>
              <div className="text-xs whitespace-pre-wrap border-l-2 border-warning pl-6 py-2">
                {plan}
              </div>
            </div>
          )}

          {plan && entries.length > 0 && (
            <div className="text-2xs text-text-muted mb-2 shrink-0">기록</div>
          )}

          {entries.length === 0 && !plan ? (
            <div className="text-xs text-text-muted whitespace-pre-wrap" data-testid="board-empty">
              {teams.length === 0
                ? '아직 회의록이 없습니다.\n팀장을 고용하고 팀원에게 일을 배분하면 여기에 쌓입니다.'
                : '아직 회의록이 없습니다.\n팀장이 팀원에게 일을 배분하면 여기에 쌓입니다.'}
            </div>
          ) : (
            entries.map((e, i) => <EntryRow key={i} entry={e} />)
          )}
        </div>
      ) : (
        <DashboardTab
          employees={employees}
          agentTools={agentTools}
          permissionCounts={permissionCounts}
          busy={busy}
          agentStatuses={agentStatuses}
          agentTokenInfo={agentTokenInfo}
          feed={feed}
        />
      )}

      <ResizeHandle onPointerDown={startResize} testId="board-resize-handle" />
    </div>
  );
}
