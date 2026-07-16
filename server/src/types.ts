import type { StringDecoder } from 'string_decoder';
import type * as vscode from 'vscode';

export interface AgentState {
  id: number;
  sessionId: string;
  /** Terminal reference — undefined for extension panel sessions */
  terminalRef?: vscode.Terminal;
  /** Whether this agent was detected from an external source (VS Code extension panel, etc.) */
  isExternal: boolean;
  projectDir: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
  /** Incremental UTF-8 decoder for the JSONL byte stream. Lazily created in
   *  readNewLines. Reads are capped at 64KB, so a multi-byte character can
   *  straddle a read boundary; the decoder buffers the incomplete trailing
   *  bytes until the next read instead of emitting � for them. Reset (undefined)
   *  whenever the agent is pointed at a new file (fileOffset back to 0). */
  utf8Decoder?: StringDecoder;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
  activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
  backgroundAgentToolIds: Set<string>; // tool IDs for run_in_background Agent calls (stay alive until queue-operation)
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;
  /** Timestamp of last JSONL data received (ms since epoch) */
  lastDataAt: number;
  /** Total JSONL lines processed for this agent */
  linesProcessed: number;
  /** Set of record.type values we've already warned about (prevents log spam) */
  seenUnknownRecordTypes: Set<string>;
  /** Whether a hook event has been delivered for this agent (suppresses heuristic timers) */
  hookDelivered: boolean;
  /** True when agent has no transcript file (provider doesn't use JSONL). All state from hooks. */
  hooksOnly?: boolean;
  /** Provider that created this agent (defaults to 'claude') */
  providerId?: string;
  /** Set when SessionEnd(reason=clear) fires; cleared when SessionStart(source=clear) reassigns */
  pendingClear?: boolean;
  /** Generation counter for pendingClear. Each SessionEnd(clear/resume) bumps it;
   *  the grace-period safety-net timer captures the value at schedule time and
   *  only cleans up if it still matches — so a stale timer from an earlier clear
   *  cycle can't tear down a later, legitimate one that reused pendingClear. */
  pendingClearToken?: number;
  /** Hook-generated tool ID for PreToolUse/PostToolUse correlation */
  currentHookToolId?: string;
  /** Tool name from the most recent PreToolUse, used to correlate a later SubagentStart
   *  event with the parent tool that launched it. */
  currentHookToolName?: string;
  /** True if the CURRENT PreToolUse tool call is a teammate spawn (per the provider's
   *  `team.isTeammateSpawnCall`). Authoritative source for teammate vs basic-subagent
   *  routing in SubagentStart. Set in PreToolUse, NOT cleared in PostToolUse (survives
   *  the PostToolUse-before-SubagentStart race); overwritten on the next PreToolUse. */
  currentHookIsTeammateSpawn?: boolean;

  // -- Token tracking --
  inputTokens: number;
  outputTokens: number;
  /** Model id from the latest assistant record (e.g. claude-fable-5) */
  model?: string;
  /** Latest request context size (input + cache read/creation + output) */
  contextTokens?: number;
  /** message.id of the last counted usage — dedupes multi-block assistant records */
  lastUsageMessageId?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  /** True when lead spawns teammates via tmux (run_in_background Agent calls) */
  teamUsesTmux?: boolean;

  // -- Employee appearance --
  /** Set only when this character is an employee re-hired from the roster (or
   *  clocked back in) with a saved look. Undefined for a brand-new hire — the
   *  webview picks the palette and reports it back via saveAgentSeats. */
  palette?: number;
  hueShift?: number;
}

export interface PersistedAgent {
  id: number;
  sessionId?: string;
  /** Terminal name — empty string for extension panel sessions */
  terminalName: string;
  /** Whether this agent was detected from an external source */
  isExternal?: boolean;
  jsonlFile: string;
  projectDir: string;
  /** Workspace folder name (only set for multi-root workspaces) */
  folderName?: string;

  // -- Agent Teams --
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}
