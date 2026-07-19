/**
 * Every message that crosses the server ↔ UI boundary, in both directions.
 *
 * Edit this file directly. It used to be generated from an AsyncAPI yaml, but
 * the spec had no second reader: the server sends plain objects and the client
 * casts what it receives, so nothing was ever validated against it — while a
 * stale spec could silently *drop* fields the server actually sends on the next
 * regeneration. The generator also threw away every field description, so the
 * docs below only became visible once the yaml went away.
 *
 * Adding a message: add the interface, add it to ServerMessage or ClientMessage,
 * and handle it where that union is consumed. `type` is the discriminant.
 */

export type ServerMessage =
  | ProviderCapabilities
  | AgentCreated
  | AgentClosed
  | AgentSelected
  | ExistingAgents
  | AgentStatus
  | AgentToolStart
  | AgentToolDone
  | AgentToolsClear
  | AgentToolPermission
  | AgentToolPermissionClear
  | SubagentToolStart
  | SubagentToolDone
  | SubagentClear
  | SubagentToolPermission
  | AgentTeamInfo
  | AgentTokenUsage
  | PlanUsage
  | ShellOutput
  | ShellExit
  | EmployeeState
  | AgentSessionEvent
  | AgentPermissionRequest
  | AgentPermissionResolved
  | HandoffNotesListed
  | BoardContent
  | BoardUpdate
  | LayoutLoaded
  | FurnitureAssetsLoaded
  | CharacterSpritesLoaded
  | PetSpritesLoaded
  | FloorTilesLoaded
  | WallTilesLoaded
  | SettingsLoaded
  | OfficeProvider
  | ExternalAssetDirectoriesUpdated
  | AllowlistListed
  | WorkspaceFolders
  | AgentDiagnostics
  | SetupCheckResult
  | OfficeNotice;

export type ClientMessage =
  | WebviewReady
  | LaunchAgent
  | FocusAgent
  | CloseAgent
  | SaveAgentSeats
  | SaveLayout
  | SetSoundEnabled
  | SetLastSeenVersion
  | SetAlwaysShowLabels
  | SetHooksEnabled
  | SetHooksInfoShown
  | SetWatchAllSessions
  | ExportLayout
  | ImportLayout
  | OpenSessionsFolder
  | AddExternalAssetDirectory
  | RemoveExternalAssetDirectory
  | RequestDiagnostics
  | RunShellCommand
  | KillShellCommand
  | HireEmployee
  | FireEmployee
  | ListHandoffNotes
  | RequestBoard
  | SendAgentMessage
  | SetAgentModel
  | RenameEmployee
  | SetEmployeePersona
  | ClockIn
  | ClockOut
  | AgentPermissionDecision
  | AddToAllowlist
  | ListAllowlist
  | RemoveFromAllowlist
  | RefreshPlanUsage
  | SetOfficeProvider
  | RunSetupCheck
  | SetOnboardingDone;

/**
 * Sent once after `webviewReady`, before any agent messages. Tells the client
 * which tool names should render with the "reading" animation and which spawn
 * sub-agent characters.
 */
export interface ProviderCapabilities {
  type: 'providerCapabilities';
  /** Tool names that should render the reading animation (vs typing). */
  readingTools: string[];
  /** Tool names that spawn sub-agent characters (e.g. Task, Agent). */
  subagentToolNames: string[];
}

/** A new agent has appeared in the office. */
export interface AgentCreated {
  type: 'agentCreated';
  id: number;
  folderName?: string;
  isExternal?: boolean;
  /** True when this agent is a teammate spawned by a lead (has a parent). */
  isTeammate?: boolean;
  /** The teammate's role/name within its team. */
  teammateName?: string;
  /** agentId of the lead this teammate belongs to. */
  parentAgentId?: number;
  /** Name of the team this agent belongs to. */
  teamName?: string;
  /** True when the agent has no transcript file (all state comes from hooks). */
  hooksOnly?: boolean;
  /**
   * Employees only. The look frozen on their roster entry (rehire, or
   * clock-in after a clock-out). Absent for a brand-new hire — the
   * webview picks one via pickDiversePalette() and reports it back
   * through saveAgentSeats.
   */
  palette?: number;
  /** Hue rotation in degrees, paired with palette. */
  hueShift?: number;
}

/** An agent has been removed from the office. */
export interface AgentClosed {
  type: 'agentClosed';
  id: number;
}

/** An agent's terminal was focused (VS Code only). UI should highlight it. */
export interface AgentSelected {
  type: 'agentSelected';
  id: number;
}

/**
 * Snapshot of all current agents. Sent on initial connect and after agent set
 * changes that the client missed. Includes seat/palette assignments.
 */
export interface ExistingAgents {
  type: 'existingAgents';
  agents: number[];
  /** Map of agent ID (string) to seat metadata. */
  agentMeta: Record<string, AgentSeatMeta>;
  /** Map of agent ID (string) to workspace folder name. */
  folderNames: Record<string, string>;
  /** Map of agent ID (string) to external flag. */
  externalAgents: Record<string, boolean>;
}

/**
 * Seat metadata associated with an agent (palette index, hue shift, seat ID).
 * Used in `existingAgents.agentMeta`. All fields optional because some agents
 * may not have a seat assignment yet.
 */
export interface AgentSeatMeta {
  palette?: number;
  hueShift?: number;
  seatId?: string;
}

/** Active vs waiting state for an agent (drives character animation). */
export interface AgentStatus {
  type: 'agentStatus';
  id: number;
  status: AgentActivityStatus;
  /** Only meaningful when status is "waiting". True when the agent went idle waiting on the user (drives the "Waiting for input" label); absent/false means the agent finished its turn ("Done"). */
  awaitingInput?: boolean;
}

/** Activity state of an agent. */
export type AgentActivityStatus = 'active' | 'waiting';

/** Agent began executing a tool. */
export interface AgentToolStart {
  type: 'agentToolStart';
  id: number;
  toolId: string;
  /** Human-readable status to display (e.g. "Reading foo.ts"). */
  status: string;
  toolName?: string;
  permissionActive?: boolean;
  runInBackground?: boolean;
}

/** Agent finished executing a tool. */
export interface AgentToolDone {
  type: 'agentToolDone';
  id: number;
  toolId: string;
}

/** All foreground tools cleared (turn end). Background agents preserved. */
export interface AgentToolsClear {
  type: 'agentToolsClear';
  id: number;
}

/** Permission prompt detected for the agent's current tool. */
export interface AgentToolPermission {
  type: 'agentToolPermission';
  id: number;
}

/** Permission prompt resolved. */
export interface AgentToolPermissionClear {
  type: 'agentToolPermissionClear';
  id: number;
}

/** Sub-agent (e.g. Task) started a tool. */
export interface SubagentToolStart {
  type: 'subagentToolStart';
  id: number;
  parentToolId: string;
  toolId: string;
  status: string;
}

/** Sub-agent finished a tool. */
export interface SubagentToolDone {
  type: 'subagentToolDone';
  id: number;
  parentToolId: string;
  toolId: string;
}

/** A sub-agent task completed. */
export interface SubagentClear {
  type: 'subagentClear';
  id: number;
  parentToolId: string;
}

/** Permission prompt for a sub-agent's tool. */
export interface SubagentToolPermission {
  type: 'subagentToolPermission';
  id: number;
  parentToolId: string;
}

/** Agent Teams metadata (lead, teammate, tmux usage). */
export interface AgentTeamInfo {
  type: 'agentTeamInfo';
  id: number;
  teamName?: string;
  agentName?: string;
  isTeamLead?: boolean;
  leadAgentId?: number;
  teamUsesTmux?: boolean;
}

/** Cumulative token usage for the agent's session. */
export interface AgentTokenUsage {
  type: 'agentTokenUsage';
  id: number;
  inputTokens: number;
  outputTokens: number;
  /** Model id from the latest assistant record (e.g. claude-fable-5). */
  model?: string;
  /** Latest request context size (input + cache read/creation + output). */
  contextTokens?: number;
  /** Context window for the configured model (1M for "[1m]" variants, else 200k). */
  contextLimit?: number;
}

/**
 * Estimated Claude plan usage gauges. Percentages are estimated from
 * weighted aggregation of local transcript JSONL usage records
 * (input x1, cache creation x1.25, cache read x0.1, output x5),
 * calibrated against the user snapshot in ~/.pixel-agents/plan-usage.json.
 * Only tokens recorded after each gauge's last reset are counted.
 * Broadcast periodically by the server.
 */
export interface PlanUsage {
  type: 'planUsage';
  /** Estimated 0-100 percent of the 5-hour session limit. */
  sessionPercent: number;
  /** ISO timestamp when the session gauge resets. */
  sessionResetsAt?: string;
  /** Estimated 0-100 percent of the weekly all-model limit. */
  weeklyAllPercent: number;
  /** Estimated 0-100 percent of the weekly per-model (Fable) limit. */
  weeklyModelPercent: number;
  /** ISO timestamp when both weekly gauges reset. */
  weeklyResetsAt?: string;
  /** False when no snapshot file exists (percentages are uncalibrated raw estimates). */
  calibrated: boolean;
}

/**
 * One chunk of output from a shell command started via RunShellCommand.
 * `system` stream carries bridge-level notices (timeout, kill, spawn errors).
 */
export interface ShellOutput {
  type: 'shellOutput';
  execId: string;
  stream: ShellStreamName;
  data: string;
}

export type ShellStreamName = 'stdout' | 'stderr' | 'system';

/** Command finished (or failed to spawn). Terminal message for an execId. */
export interface ShellExit {
  type: 'shellExit';
  execId: string;
  exitCode?: number;
  /** Present when the process could not be spawned or was killed. */
  error?: string;
}

/**
 * The whole staff. Broadcast whenever someone is hired, fired, or reports
 * a new model / context fill. Each employee owns one session and one
 * office character, keyed by the same agentId.
 */
export interface EmployeeState {
  type: 'employeeState';
  employees: EmployeeInfo[];
}

export interface EmployeeInfo {
  /** Also the id of this employee's office character. */
  agentId: number;
  name: string;
  /** The folder this employee is responsible for. */
  cwd: string;
  role: EmployeeRole;
  duty: EmployeeDuty;
  /**
   * What to call this employee on screen. Free text — the office decides
   * what a job is named. `role` still decides what they may do; falls back
   * to a default label when unset.
   */
  roleLabel?: string;
  /**
   * Free-text standing instructions for this employee, appended to their
   * session's system prompt at hire time.
   */
  persona?: string;
  /** Model of the employee's latest reply; empty until it answers. */
  model?: string;
  /**
   * How full the employee's context window is, taken from the reply's own
   * usage (uncached + cached + output). 0 until it answers.
   */
  contextTokens?: number;
  contextLimit?: number;
  authMode?: AuthMode;
  /** True when this employee overrides the office default. */
  ownProvider?: boolean;
  /**
   * What this employee's session has cost in total, taken from the running
   * total the SDK reports on every result (measured: it reports the session
   * total, not the turn's own cost). The SDK prices subscription work too,
   * so this is only shown in apiKey mode — there it is an actual bill; on a
   * subscription it would be a number nobody is charged.
   */
  costUsd?: number;
  /**
   * How far this member's delegated job has got. Absent when the lead has not
   * given them one.
   *
   * pending = held until they clock in. running = working. done = finished but
   * NOT yet collected — a state that only exists because collect returns without
   * waiting, and the one worth showing: it is why the lead calls collect again.
   */
  work?: 'pending' | 'running' | 'done';
}

/**
 * lead = the only rank that may delegate. staff = owns one folder and
 * does the work.
 */
export type EmployeeRole = 'lead' | 'staff';

/**
 * on = has a live session, shows as a character in the office. clockingOut
 * = wrapping up a handoff note before the session closes (toggle disabled,
 * shown as "퇴근 중…"). off = no session, no character; still on the
 * roster, dimmed in the staff panel, until clocked back in.
 */
export type EmployeeDuty = 'on' | 'clockingOut' | 'off';

/**
 * How an employee's session authenticates to Claude. The mode is decided by
 * which credential is injected into the session's environment, following the
 * SDK's own precedence (ANTHROPIC_API_KEY > login):
 *
 * - subscription: no credential injected (the env var is removed), so the SDK
 *   falls back to the local Claude Code login of whoever runs the server.
 * - apiKey: ANTHROPIC_API_KEY — pay-per-use, the only mode fit for someone
 *   other than the server's owner.
 *
 * Plan gauges only mean something for subscription; an apiKey employee
 * reports accumulated cost in dollars instead.
 */
export type AuthMode = 'subscription' | 'apiKey';

/**
 * One piece of an employee's transcript: the user's own message echoed
 * back, assistant text, a tool name, a turn result, or the office itself
 * speaking (`system` — e.g. confirming a model switch).
 */
export interface AgentSessionEvent {
  type: 'agentEvent';
  agentId: number;
  kind: AgentEventKind;
  text: string;
  /**
   * The tool call's input, as raw JSON text. Only set when kind is
   * `tool` — every other kind omits it. Parsing and summarizing this
   * is the client's job, not the server's.
   */
  input?: string;
}

export type AgentEventKind = 'user' | 'text' | 'tool' | 'result' | 'system';

/**
 * An employee's tool call needs approval. That employee's session blocks
 * until the client answers with AgentPermissionDecision (or it times out).
 */
export interface AgentPermissionRequest {
  type: 'agentPermissionRequest';
  agentId: number;
  requestId: string;
  toolName: string;
  /** Prompt sentence rendered by the SDK, when available. */
  title: string;
  /** Truncated JSON of the tool input, for display. */
  input: string;
}

/**
 * A pending AgentPermissionRequest is no longer pending — decided, timed
 * out, or dropped on dispose. Clients clear the card and the bubble.
 */
export interface AgentPermissionResolved {
  type: 'agentPermissionResolved';
  agentId: number;
  requestId: string;
}

/**
 * Response to listHandoffNotes. Sent to the requesting client only —
 * never broadcast, since two clients could be browsing different cwds.
 */
export interface HandoffNotesListed {
  type: 'handoffNotesListed';
  cwd: string;
  notes: HandoffNoteSummary[];
}

/** One employee's most recent handoff note, as offered in a "resume from" picker. */
export interface HandoffNoteSummary {
  /** Handoff folder key (see getHandoffDir) — pass back as hireEmployee's handoffFromKey. */
  key: string;
  /** Name of the employee who wrote this note (from its frontmatter). */
  employee: string;
  /** ISO timestamp the note was saved (from its frontmatter). */
  savedAt: string;
}

/**
 * Response to requestBoard — the whole shared meeting board (BOARD.md at
 * the team root). Sent to the requesting client only, never broadcast:
 * it is a full-file read answering one client's open modal.
 * available is false when no lead is on the roster (so no team root is
 * known), the requested teamRoot is not a known one, or the board has not
 * been written yet — all empty states, not errors.
 */
export interface BoardContent {
  type: 'boardContent';
  available: boolean;
  /** Raw BOARD.md text. Empty string when available is false. */
  content: string;
  /** Absolute path the board was read from. Absent when unavailable. */
  path?: string;
  /**
   * The team root this content is for, echoed back so a client that
   * switched teams while a read was in flight can drop the late answer
   * for the team it no longer shows. Absent when unavailable.
   */
  teamRoot?: string;
}

/**
 * One line just appended to the shared board by delegate/collect.
 * Broadcast to every client so an open board view can append it live
 * without re-reading the file.
 */
export interface BoardUpdate {
  type: 'boardUpdate';
  /** Entry category, in Korean — 배분 | 수거 | 메모 | 계획. */
  kind: string;
  /** The team member the entry is about (배분/수거), absent for entries about the
   *  team as a whole (계획, and the lead's own 메모). A live view uses this to draw
   *  the arrow at the moment the board records it. */
  agentId?: number;
  /** The entry body, without the time and kind prefix. */
  text: string;
  /** The full rendered markdown line as written to BOARD.md. */
  entry: string;
  /** Epoch milliseconds the entry was appended. */
  at: number;
}

/**
 * Office layout (tiles, furniture, colors). `null` when no layout file or
 * bundled default exists. `wasReset` is true when the bundled default
 * replaced an outdated user layout.
 */
export interface LayoutLoaded {
  type: 'layoutLoaded';
  layout: Record<string, any> | null;
  wasReset?: boolean;
}

/** Furniture catalog and sprite data, sent once after webviewReady. */
export interface FurnitureAssetsLoaded {
  type: 'furnitureAssetsLoaded';
  catalog: FurnitureAssetMessage[];
  /** Map of furniture asset ID to its sprite (2D hex string array). */
  sprites: Record<string, string[][]>;
}

/** One entry in the furniture catalog (sent in `furnitureAssetsLoaded`). */
export interface FurnitureAssetMessage {
  id: string;
  name: string;
  label: string;
  category: string;
  file: string;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  isDesk: boolean;
  canPlaceOnWalls: boolean;
  groupId?: string;
  canPlaceOnSurfaces?: boolean;
  backgroundTiles?: number;
  orientation?: string;
  state?: string;
  mirrorSide?: boolean;
  rotationScheme?: string;
  animationGroup?: string;
  frame?: number;
}

/** Pre-colored character sprite sets (6 palettes), sent once at startup. */
export interface CharacterSpritesLoaded {
  type: 'characterSpritesLoaded';
  characters: CharacterSpriteSet[];
}

/**
 * One palette's character sprites as 3D hex-string arrays (frames × rows × pixels).
 * Three direction sets per palette: down, up, right (left is rendered as flipped right).
 */
export interface CharacterSpriteSet {
  down: string[][][];
  up: string[][][];
  right: string[][][];
}

/** Pet sprite frame sets and display names, sent once after webviewReady (between characterSpritesLoaded and floorTilesLoaded). */
export interface PetSpritesLoaded {
  type: 'petSpritesLoaded';
  /** One frame-set per loaded pet, indexed by petType. */
  pets: PetSpriteFrameSet[];
  /** Display names parallel-indexed to `pets` (sourced from each pet's manifest.json). */
  petNames: string[];
}

/** One pet's frames keyed by direction + state. All arrays are 3D hex-string arrays (frames × rows × pixels). */
export interface PetSpriteFrameSet {
  /** 3 frames at 16×32 pixels. */
  walkDown: string[][][];
  /** 3 frames at 16×32 pixels. */
  idleDown: string[][][];
  /** 3 frames at 16×32 pixels. */
  walkUp: string[][][];
  /** 3 frames at 16×32 pixels. */
  idleUp: string[][][];
  /** 3 frames at 32×32 pixels. */
  walkRight: string[][][];
}

/** Floor tile sprites (7 patterns). */
export interface FloorTilesLoaded {
  type: 'floorTilesLoaded';
  /** Array of 2D hex string arrays (one per pattern). */
  sprites: string[][][];
}

/** Wall auto-tile sprite sets (16 bitmask pieces). */
export interface WallTilesLoaded {
  type: 'wallTilesLoaded';
  /** Array of wall tile sets; each set is an array of 2D hex string arrays. */
  sets: string[][][][];
}

/** All persisted user-level settings, sent once on connect. */
export interface SettingsLoaded {
  type: 'settingsLoaded';
  soundEnabled: boolean;
  lastSeenVersion: string;
  extensionVersion: string;
  watchAllSessions: boolean;
  alwaysShowLabels: boolean;
  hooksEnabled: boolean;
  hooksInfoShown: boolean;
  externalAssetDirectories: string[];
  /**
   * Whether the first-run onboarding wizard has been completed (or
   * dismissed). Not required — the VS Code adapter never sends it, so
   * a client that only knows the required fields must still treat its
   * absence as "don't show onboarding" (browser client defaults this
   * state to true until the value arrives).
   */
  onboardingDone?: boolean;
}

/**
 * The office default AI, as the client is allowed to see it: the mode and
 * whether a secret is on file, never the secret itself. Sent on webviewReady
 * and after every SetOfficeProvider.
 */
export interface OfficeProvider {
  type: 'officeProvider';
  mode: AuthMode;
  /** A key/token is stored for this mode (its value is never sent). */
  hasSecret: boolean;
  model?: string;
}

/** External asset directory list changed (after add/remove). */
export interface ExternalAssetDirectoriesUpdated {
  type: 'externalAssetDirectoriesUpdated';
  dirs: string[];
}

/**
 * Every employee's standing automode permissions, for the settings panel.
 * Sent in reply to `listAllowlist`, and again after `removeFromAllowlist`
 * so the list the user is looking at reflects the delete without a reload.
 *
 * Carries names because the permissions file is keyed by an opaque
 * employeeKey the client cannot resolve — it would otherwise have nothing
 * to label the groups with.
 */
export interface AllowlistListed {
  type: 'allowlistListed';
  employees: AllowlistEmployee[];
}

/**
 * One employee on the roster with their standing permissions. Sent even
 * when `allow` is empty: the panel lists everyone who works here, and a
 * missing name would read as "no such employee" rather than "this one has
 * allowed nothing".
 */
export interface AllowlistEmployee {
  /** What the client sends back in `removeFromAllowlist`. */
  agentId: number;
  name: string;
  allow: AllowlistEntry[];
}

/**
 * One standing permission in an employee's allowlist — the stored
 * ToolPermission as it goes over the wire.
 */
export interface AllowlistEntry {
  tool: string;
  match: ToolPermissionMatch;
  value: string;
  /** ISO 8601 timestamp of when the user granted this. */
  addedAt: string;
}

/**
 * How an allowlist entry is compared against a tool use. 'exact' — the
 * value must be identical (the only form Bash is allowed, since a prefix
 * would let anything trail an approved command). 'dirPrefix' — the path
 * must be the directory or sit inside it.
 *
 * Named rather than inlined at each use: Modelina turns a repeated inline
 * enum into AnonymousSchema_N, and the N shifts under every later edit to
 * this file.
 */
export type ToolPermissionMatch = 'exact' | 'dirPrefix';

/** Multi-root workspace folders (VS Code only). */
export interface WorkspaceFolders {
  type: 'workspaceFolders';
  folders: WorkspaceFolder[];
}

export interface WorkspaceFolder {
  name: string;
  path: string;
}

/** Connection diagnostics for all agents (response to requestDiagnostics). */
export interface AgentDiagnostics {
  type: 'agentDiagnostics';
  /** Per-agent diagnostic info; shape opaque to the protocol. */
  agents: Record<string, any>[];
}

/**
 * Response to runSetupCheck. Sent to the requesting client only — never
 * broadcast, since two clients could be checking different modes.
 */
export interface SetupCheckResult {
  type: 'setupCheckResult';
  mode: AuthMode;
  checks: SetupCheck[];
}

/** One prerequisite's result, as evidence only — no user-facing copy. */
export interface SetupCheck {
  id: SetupCheckId;
  status: SetupCheckStatus;
  /**
   * Evidence backing the status (CLI version string, last non-empty
   * stderr line, HTTP status/model id). Korean remediation copy is
   * owned by the webview, not sent here.
   */
  detail?: string;
}

/** Which onboarding prerequisite a SetupCheck entry reports on. */
export type SetupCheckId = 'claudeInstalled' | 'claudeLoggedIn' | 'apiKeyFormat' | 'apiKeyValid';

/**
 * ok/fail are terminal results; skip means a prior check in the same
 * mode already failed so this one could not meaningfully run (e.g.
 * claudeLoggedIn when claudeInstalled failed).
 */
export type SetupCheckStatus = 'ok' | 'fail' | 'skip';

/**
 * A notice for every connected client — replaces failures that used to
 * be swallowed by a bare console.error (e.g. hireEmployee/clockIn
 * rejecting, or an employee's session dying right after hire).
 * Broadcast.
 */
export interface OfficeNotice {
  type: 'officeNotice';
  level: OfficeNoticeLevel;
  text: string;
}

export type OfficeNoticeLevel = 'info' | 'error';

/** Client signals it's ready to receive state. */
export interface WebviewReady {
  type: 'webviewReady';
}

/** Launch a new Claude agent in a new terminal. */
export interface LaunchAgent {
  type: 'launchAgent';
  /** Workspace folder path (for multi-root workspaces). */
  folderPath?: string;
  bypassPermissions?: boolean;
}

/** Focus an agent's terminal. */
export interface FocusAgent {
  type: 'focusAgent';
  id: number;
}

/** Close (dismiss) an agent. */
export interface CloseAgent {
  type: 'closeAgent';
  id: number;
}

/** Persist seat assignments for current agents. */
export interface SaveAgentSeats {
  type: 'saveAgentSeats';
  /** Map of agent ID (string) to seat assignment. */
  seats: Record<string, SeatAssignment>;
}

/**
 * Required seat assignment payload sent in `saveAgentSeats`. `seatId` may be
 * null when the agent is unseated (left their chair). All other fields required.
 */
export interface SeatAssignment {
  palette: number;
  hueShift: number;
  seatId: string | null;
}

/** Save the office layout to ~/.pixel-agents/layout.json. */
export interface SaveLayout {
  type: 'saveLayout';
  /** Opaque layout object; format owned by the rendering layer. */
  layout: Record<string, any>;
}

export interface SetSoundEnabled {
  type: 'setSoundEnabled';
  enabled: boolean;
}

export interface SetLastSeenVersion {
  type: 'setLastSeenVersion';
  version: string;
}

export interface SetAlwaysShowLabels {
  type: 'setAlwaysShowLabels';
  enabled: boolean;
}

export interface SetHooksEnabled {
  type: 'setHooksEnabled';
  enabled: boolean;
}

export interface SetHooksInfoShown {
  type: 'setHooksInfoShown';
}

export interface SetWatchAllSessions {
  type: 'setWatchAllSessions';
  enabled: boolean;
}

/** Trigger layout export via host-native save dialog. */
export interface ExportLayout {
  type: 'exportLayout';
}

/** Trigger layout import via host-native open dialog. */
export interface ImportLayout {
  type: 'importLayout';
}

/** Open ~/.claude/projects in the OS file manager. */
export interface OpenSessionsFolder {
  type: 'openSessionsFolder';
}

/** Add an external asset directory (host shows a directory picker). */
export interface AddExternalAssetDirectory {
  type: 'addExternalAssetDirectory';
}

/** Remove an external asset directory by path. */
export interface RemoveExternalAssetDirectory {
  type: 'removeExternalAssetDirectory';
  path: string;
}

/** Request agent connection diagnostics (server responds with agentDiagnostics). */
export interface RequestDiagnostics {
  type: 'requestDiagnostics';
}

/**
 * Execute a PowerShell command on the server host (standalone mode only).
 * The server streams ShellOutput chunks and always finishes with ShellExit.
 * The server binds to 127.0.0.1, so only local clients can reach this.
 */
export interface RunShellCommand {
  type: 'runShellCommand';
  /** Client-generated id correlating ShellOutput/ShellExit messages. */
  execId: string;
  command: string;
  /** Working directory. Defaults to the server process cwd. */
  cwd?: string;
}

/** Terminate a running shell command by execId. */
export interface KillShellCommand {
  type: 'killShellCommand';
  execId: string;
}

/**
 * Hire an employee: start a session in the given folder and put a matching
 * character in the office. Standalone mode only; the session runs on the
 * server host, authenticated by the provider given here (or the office
 * default when `provider` is omitted). Tool calls needing approval go through
 * AgentPermissionRequest.
 */
export interface HireEmployee {
  type: 'hireEmployee';
  name: string;
  /** The folder this employee is responsible for. */
  cwd: string;
  role: EmployeeRole;
  /** What to call them on screen. Defaults by role when omitted. */
  roleLabel?: string;
  /**
   * Standing instructions for this employee. Applied when the session
   * starts, so a change only reaches them on a re-hire.
   */
  persona?: string;
  provider?: EmployeeProvider;
  /**
   * The model to hire them on. Omitted = the office default at hire time.
   * A preset recommends one per job, but the user may override it.
   */
  model?: string;
  /**
   * Resume from another (or the same) employee's most recent handoff
   * note, read directly from that folder key (see HandoffNoteSummary.key,
   * from listHandoffNotes/handoffNotesListed) — so a differently-named
   * hire can pick up where someone else left off. Omitted = a plain
   * first-shift start with no note.
   */
  handoffFromKey?: string;
  /**
   * The scaffolded team folder this hire's cwd sits inside, sent only
   * when the hire came from a scaffold-team roster. Present = grant this
   * employee read access (Read/Grep/Glob) across the whole team folder,
   * so someone working in one subfolder can read a teammate's without a
   * prompt per file. Omitted (hand-typed cwd, onboarding, rehire) =
   * grant nothing.
   *
   * A hint, not a fact: the server grants only if cwd really is inside
   * it, so a wrong or forged value widens nothing.
   */
  teamRoot?: string;
}

/**
 * The AI an employee is plugged into. Omitted at hire time = follow the
 * office default. Secrets travel client -> server only; they are stored in the
 * home directory and never sent back to a client (see OfficeProvider).
 */
export interface EmployeeProvider {
  mode: AuthMode;
  /** Required when mode is apiKey. */
  apiKey?: string;
}

/** End an employee's session and remove their character. */
export interface FireEmployee {
  type: 'fireEmployee';
  agentId: number;
  /**
   * Also delete this employee's handoff notes from disk. Omitted/false
   * keeps them, so a later hire can offer to resume from them.
   */
  deleteHandoff?: boolean;
}

/**
 * Ask which handoff notes exist under a cwd, so a hire form can offer
 * them as "resume from" choices. Answered with handoffNotesListed, sent
 * to this client only.
 */
export interface ListHandoffNotes {
  type: 'listHandoffNotes';
  cwd: string;
}

/**
 * Ask for the shared meeting board (BOARD.md). Answered with boardContent,
 * sent to this client only.
 *
 * teamRoot is a choice among known roots, NOT a path to open. There can be
 * several leads, each with its own team root and its own board, so the
 * client has to be able to say which one it means. The server answers only
 * when the value resolves to the cwd of a lead currently on the roster;
 * anything else is refused as unavailable. Omit it to get the first lead's
 * board, which is the whole story when there is only one team.
 *
 * The value is never joined onto a filename off the wire and never matched
 * by prefix — see readBoard in server/src/employees.ts. That is what keeps
 * /ws, which can be reached from 0.0.0.0, from becoming an arbitrary file
 * read.
 */
export interface RequestBoard {
  type: 'requestBoard';
  /** Team root to read the board of. Must equal a hired lead's cwd. */
  teamRoot?: string;
}

/** Send one user message to a specific employee. */
export interface SendAgentMessage {
  type: 'sendAgentMessage';
  agentId: number;
  text: string;
}

/**
 * Switch one employee's model, mid-session. Unlike SetClaudeModel (which
 * only writes the default for new sessions), this reaches the running
 * session — so each employee can be on the model their work is worth.
 */
export interface SetAgentModel {
  type: 'setAgentModel';
  agentId: number;
  model: string;
}

/**
 * Change what an employee is called on screen. Display only — it does not
 * touch their role, and their session keeps running untouched.
 */
export interface RenameEmployee {
  type: 'renameEmployee';
  agentId: number;
  roleLabel: string;
}

/**
 * Rewrite an employee's standing instructions. Saved to the roster, not
 * pushed into the running session — it takes effect on the next hire.
 */
export interface SetEmployeePersona {
  type: 'setEmployeePersona';
  agentId: number;
  persona: string;
}

/** Start this employee's session again. If they left a handoff note from their last shift, it is read into context via a system-prompt append (no turn is run — they only speak once the user does). */
export interface ClockIn {
  type: 'clockIn';
  agentId: number;
}

/** End this employee's shift: they summarize their work into a handoff note, then their session closes and their character leaves the office. They stay on the roster, off duty, until clocked back in. */
export interface ClockOut {
  type: 'clockOut';
  agentId: number;
}

/** Allow or deny a pending tool call, answering AgentPermissionRequest. */
export interface AgentPermissionDecision {
  type: 'agentPermissionDecision';
  requestId: string;
  allow: boolean;
}

/**
 * Add a tool use to an employee's automode allowlist. Sent when the user
 * clicks "허용 + 다음부터 묻지 않기" on a permission card.
 */
export interface AddToAllowlist {
  type: 'addToAllowlist';
  /**
   * Which employee. The server resolves the allowlist identity from its own
   * roster — the client never sends a key. A key off the wire would be an
   * unverifiable claim, and this server can bind 0.0.0.0, where /ws accepts
   * Origin-less callers with no token at all.
   */
  agentId: number;
  /** Tool name (Bash, Read, Grep, Glob, Edit, Write, etc.) */
  toolName: string;
  match: ToolPermissionMatch;
  /** For Bash, the exact command; for Read/Grep/Glob/Edit/Write, the directory path */
  value: string;
}

/**
 * Ask for every employee's standing automode permissions. Sent when the
 * settings panel opens. Answered with `allowlistListed`.
 */
export interface ListAllowlist {
  type: 'listAllowlist';
}

/**
 * Drop one standing permission from an employee's allowlist. Sent when the
 * user clicks the x next to an entry in the settings panel. Answered with a
 * fresh `allowlistListed`.
 */
export interface RemoveFromAllowlist {
  type: 'removeFromAllowlist';
  /**
   * Which employee. As with addToAllowlist, the server resolves the
   * allowlist identity from its own roster and never trusts a key off the
   * wire — this port can be reached without a token.
   */
  agentId: number;
  toolName: string;
  match: ToolPermissionMatch;
  /**
   * Identifies the entry together with toolName and match. The three of
   * them are what addPermission dedupes on, so they name exactly one row.
   */
  value: string;
}

/**
 * Re-calibrate the plan gauges by running `claude -p /usage` (a local
 * slash command: no model call, zero tokens) and rewriting the snapshot.
 * The server answers with a fresh PlanUsage broadcast.
 */
export interface RefreshPlanUsage {
  type: 'refreshPlanUsage';
}

/**
 * Set the office-wide default AI: which credential every employee gets
 * unless they carry their own. Saved to the home directory, applied to
 * employees hired from now on (running sessions keep the credential they
 * started with). The server answers with an OfficeProvider broadcast.
 */
export interface SetOfficeProvider {
  type: 'setOfficeProvider';
  mode: AuthMode;
  /** Required when mode is apiKey. Stored in the home directory only. */
  apiKey?: string;
  /**
   * Default model for employees. Empty falls back to ~/.claude/settings.json
   * in subscription mode, and to the SDK default otherwise.
   */
  model?: string;
}

/**
 * Ask the server to run onboarding prerequisite checks for an auth mode
 * (Claude Code installed/logged in for subscription; key format/validity
 * for apiKey). Answered with setupCheckResult, sent to this client only.
 */
export interface RunSetupCheck {
  type: 'runSetupCheck';
  /** Mode to check. Omitted = the office's current default mode. */
  mode?: AuthMode;
}

/**
 * Mark the first-run onboarding wizard as complete, or reopen it by
 * sending false (used by "온보딩 다시 보기" in Settings).
 */
export interface SetOnboardingDone {
  type: 'setOnboardingDone';
  done: boolean;
}
