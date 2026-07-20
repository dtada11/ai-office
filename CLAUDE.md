# Pixel Agents — Compressed Reference

Pixel art office where AI agents (Claude Code terminals today, any tool tomorrow) become animated characters. Ships as a **VS Code extension** and an **`npx pixel-agents` standalone CLI** from the same source tree.

## ⚠️ 이 저장소는 포크다 — "AI 오피스" (`main` 브랜치)

이 문서의 아래 내용은 **원본(upstream) pixel-agents 기준**이고 여전히 대부분 유효하지만, 이 포크(`origin` = github.com/dtada11/ai-office, 작업 브랜치 `main`)에는 원본에 없는 기능 계층이 얹혀 있다. 이 포크에서 코딩할 때 먼저 알아야 할 것:

- **직원 = 세션 = 캐릭터** — `server/src/employee.ts`(어댑터 경계 — Agent SDK 타입이 이 파일 밖으로 못 나감) + `server/src/employees.ts`(직원 레지스트리, agentId 키). 고용하면 Claude Agent SDK 상주 세션이 열리고 캐릭터를 **직접 생성**한다(폴더 감시 미등록 — 터미널 세션 혼입 방지). 승인 대기는 `canUseTool`→웹뷰 결재 카드, 타임아웃 30분.
- **직급·위임** — 부사장(vp) 세션에만 인프로세스 MCP 도구 `list_staff`/`delegate` 주입. 위임 타임아웃 15분.
- **인증 2모드** — `server/src/aiProvider.ts`: subscription(기본)/apiKey. Anthropic 정책상 제3자 앱이 구독 OAuth 토큰으로 요청을 라우팅할 수 없어 oauthToken 모드는 제거됨. 사무실 기본값(`~/.pixel-agents/ai-provider.json`) + 직원별 덮어쓰기. `buildEnv()`가 SDK `options.env`를 조립 (⚠️ SDK env는 병합이 아니라 전체 교체 — `process.env` spread 필수).
- **게이지** — `planUsage.ts` + `usageProbe.ts`(`claude -p --no-session-persistence /usage` 실측, 2분 주기, 1분 스로틀 주의), `claudeSettings.ts`.
- **웹뷰 추가분** — `EmployeeChat.tsx`(직원별 채팅창, 드래그 이동), `StaffPanel.tsx`(직원 관리), `TokenGauge.tsx`, `chatWindowPosition.ts`, `models.ts`. UI 전체 한글화.
- **테스트 기준선 = 전부 초록** (2026-07-19 기준 서버 494 / 웹뷰 197). 실패 0이 기준선이다. 빨간 걸 발견하면 기준선이 아니라 회귀다 — 예전에 "9건은 원래 실패"라는 기준선을 달고 다니다 진짜 회귀를 못 본 적이 있다.
- **커밋 메시지는 한글.** 설계 문서·작업 로그의 원본은 볼트 `F:\SecondBrain\200 프로젝트작업대\210 Projects\AI 사무실\`.

아래 원본 레퍼런스 중 이 포크에서 어긋나는 부분: Project Identity(우리는 별도 저장소), 26/18개 메시지 수(직원 관련 메시지 추가됨), webview 컴포넌트 목록.

### 상류와의 관계 — 독립 (2026-07-19 결정)

**`upstream`(pixel-agents-hq/pixel-agents)에서 통째로 머지하지 않는다.** 필요한 수정이 보이면 `git cherry-pick`으로 하나씩 골라 가져온다.

근거:

- 포크 이후 **122커밋, 186파일, +24,060/−2,448**. 직원·팀·회의보드·출퇴근·오토모드·한글화는 전부 이쪽에만 있다. 사실상 다른 제품이다.
- 실제로 **포크 이후 상류를 머지한 적이 한 번도 없다.** 이 결정은 새 방침이 아니라 이미 하고 있던 것을 명시한 것이다.
- 상류가 현재 만드는 것(e2e 영상 나레이션, 카펫·구역, 에디터 색상 선택기, VS Code↔standalone 동등화)은 대부분 이 포크의 방향과 어긋난다. 특히 VS Code 경로는 이쪽에서 접기로 한 방향이다.

**실무상 의미:** 이 저장소에서 과설계·미사용 코드를 지울 때 "상류가 업데이트로 되돌려놓을까" 걱정하지 않아도 된다. 되돌아올 경로가 없다.

**라이선스:** MIT는 포크·수정·분기를 명시적으로 허용하며 상류 추종 의무가 없다. 유일한 조건인 저작권 표시 보존은 `LICENSE`(Copyright (c) 2026 Pablo De Lucca) 원문 유지 + README 크레딧 섹션으로 충족하고 있다. **이 두 가지는 앞으로도 절대 지우지 않는다.**

## Architecture

Strict layering: `core/` depends on nothing; `server/` depends only on `core/`; `webview-ui/` depends only on `core/`; `adapters/vscode/` depends on `core/` and `server/`. The standalone CLI never imports `adapters/vscode/` and vice versa.

```
core/                                Protocol + interface definitions (zero runtime side effects)
  src/
    messages.ts                      ServerMessage / ClientMessage discriminated unions
    schemas.ts                       AgentMeta, SpriteData, FurnitureCatalogEntry
    provider.ts                      HookProvider, AgentEvent (the integration boundary)
    teamProvider.ts                  Optional TeamProvider (semantic queries for Lead + Teammates)
    transport.ts                     MessageTransport interface, TransportState
    adapter.ts                       StateAdapter, AssetCache, PersistedAgent, AgentSeat
    terminalAdapter.ts               TerminalAdapter (editor-driven terminal management)
    normalizeProjectPath.ts
    constants.ts

server/                              Lifecycle runtime + Fastify HTTP/WS server
  src/
    providers/hook/claude/           Reference HookProvider — only place that knows Claude specifics
      claude.ts                      normalizeHookEvent for 11 Claude events, formatToolStatus, file fallback
      claudeTeamProvider.ts          TeamProvider: reads ~/.claude/teams/<name>/config.json
      claudeHookInstaller.ts         Atomic install/uninstall in ~/.claude/settings.json
      constants.ts                   Claude hook event names, script path
      hooks/claude-hook.ts           Hook script (CJS+shebang, bundled to dist/hooks/claude-hook.js)
    providers/index.ts               Provider registry
    agentRuntime.ts                  Lifecycle core: timers, scanners, HookEventHandler, SessionRouter, DismissalTracker
    agentStateStore.ts               EventEmitter-backed single source of truth (typed mutations + events)
    sessionRouter.ts                 session_id → agent_id mapping, event buffering, pending external sessions
    dismissalTracker.ts              Unified dismissal state (replaces four legacy globals)
    hookEventHandler.ts              Dispatches normalized AgentEvent into runtime
    httpServer.ts                    Fastify: POST /api/hooks/:providerId, GET /api/health, GET /ws, SPA (standalone)
    clientMessageHandler.ts          Single dispatch point for ClientMessage from webview
    server.ts                        Top-level composition
    cli.ts                           npx pixel-agents entry (npm bin)
    fileStateAdapter.ts              Namespaced ~/.pixel-agents/ persistence
    configPersistence.ts             { vscode, standalone, externalAssetDirectories }
    layoutPersistence.ts             ~/.pixel-agents/layout.json with atomic tmp+rename
    fileWatcher.ts                   Hybrid fs.watch + 500ms polling, JSONL line buffering, /clear detection
    transcriptParser.ts              JSONL parsing for heuristic / file-fallback mode
    timerManager.ts                  Waiting / permission timers
    assetLoader.ts                   PNG → SpriteData via pngjs
    teamUtils.ts                     isInlineTeammateOf, getInlineTeammates, hasInlineTeammates
    types.ts                         ServerAgentState
    constants.ts                     All timing/scanning constants
  __tests__/                         13 Vitest files
  manual-hook-events.http            Manual hook testing helper (REST-Client format)

adapters/vscode/                     VS Code surface — composes core + server
  extension.ts                       activate() / deactivate()
  PixelAgentsViewProvider.ts         WebviewViewProvider, thin bridge to AgentRuntime
  agentManager.ts                    Terminal lifecycle (claude --session-id <uuid>), restore, persist
  vscodeTerminalAdapter.ts           TerminalAdapter implementation
  migrateVsCodeState.ts              One-time legacy state migration (verify-before-clear)
  constants.ts                       VS Code IDs, command names, key names

webview-ui/                          React 19 + Canvas UI (depends only on core/)
  src/
    transport/
      index.ts                       createTransport() — single runtime branching point
      postMessageTransport.ts        VS Code mode (acquireVsCodeApi)
      webSocketTransport.ts          Standalone mode (exponential backoff, send queue)
      types.ts                       Re-exports MessageTransport from core
    runtime.ts                       isBrowserRuntime detection
    browserMock.ts                   Standalone-browser asset fetch + message injection
    testHooks.ts                     window globals for the deleted e2e suite — now vestigial
    main.tsx                         React entry (StrictMode + createRoot)
    App.tsx                          Composition root (hooks + components + EditActionBar)
    constants.ts                     Webview magic numbers/strings
    notificationSound.ts             Web Audio API chime
    changelogData.ts                 Changelog modal content
    components/                      React UI (toolbars, modals, settings)
      BottomToolbar.tsx, ZoomControls.tsx, SettingsModal.tsx, InfoModal.tsx,
      Tooltip.tsx, DebugView.tsx, ui/Button.tsx, ...
    hooks/
      useExtensionMessages.ts        Message handler — translates ServerMessage into OfficeState mutations
      useEditorActions.ts            Editor state + callbacks
      useEditorKeyboard.ts           Keyboard shortcuts (R, T, Esc, Ctrl+Z/Y)
    office/
      types.ts                       OfficeLayout, Character, etc. + re-exports constants
      toolUtils.ts                   STATUS_TO_TOOL mapping, extractToolName, defaultZoom
      colorize.ts                    Colorize (grayscale→HSL) + Adjust (HSL shift)
      floorTiles.ts                  Floor sprite storage + colorized cache
      wallTiles.ts                   Wall auto-tile: 16 bitmask sprites
      sprites/
        spriteData.ts                Pixel data (characters, furniture, tiles, bubbles)
        spriteCache.ts               SpriteData → offscreen canvas, per-zoom WeakMap
      editor/
        editorActions.ts             Pure layout ops
        editorState.ts               Imperative state (tools, ghost, selection, undo/redo, drag)
        EditorToolbar.tsx
      layout/
        furnitureCatalog.ts          Dynamic catalog from loaded assets
        layoutSerializer.ts          OfficeLayout ↔ runtime (tileMap, furniture, seats)
        tileMap.ts                   Walkability, BFS pathfinding
      engine/
        characters.ts                Character FSM (idle/walk/type) + wander AI
        officeState.ts               Game world (layout, characters, seats, selection, subagents)
        gameLoop.ts                  rAF loop with delta-time cap (0.1 s)
        renderer.ts                  Canvas: tiles, z-sorted entities, overlays, edit UI
        matrixEffect.ts              Spawn/despawn digital rain
      components/
        OfficeCanvas.tsx             Canvas, resize, DPR, mouse hit-testing, drag-to-move
        ToolOverlay.tsx              Activity label above hovered/selected character

scripts/
  asset-manager.html                 Unified furniture editor (positions + metadata)
  jsonl-viewer.html                  Standalone JSONL transcript inspector
  wall-tile-editor.html              Wall sprite editor

core/                                npm workspace (no separate package; root manages)
server/                              npm workspace
webview-ui/                          npm workspace
```

## Distribution

Two artifacts from one source tree:

- **VS Code extension** (`.vsix`) — `pablodelucca.pixel-agents` on VS Code Marketplace and Open VSX. Bundles VS Code adapter + webview SPA + assets + hook scripts.
- **npm package** (`pixel-agents`) — `npx pixel-agents [--port 3100]` runs the Fastify server and serves the SPA on the same port. Bundles CLI + webview SPA + assets + hook scripts.

`package.json:files` allowlist controls the npm tarball: `dist/cli.js{,.map}`, `dist/webview/`, `dist/assets/`, `dist/hooks/`, `icon.png`. `dist/extension.js` is intentionally excluded since the VS Code entry ships through the `.vsix`.

## Communication Flow

Hub-and-spoke. The server is the single aggregation point for all agent activity, regardless of source.

```
Hook scripts ─POST /api/hooks/:providerId─┐
                                          ├─→ HookProvider.normalizeHookEvent()
JSONL transcripts ─FileWatcher─→ TranscriptParser ┤
                                                   ↓
                                              AgentEvent (canonical)
                                                   ↓
                                              AgentRuntime (dispatch on .kind)
                                                   ↓
                                           AgentStateStore (mutate)
                                                   ↓
                                              StoreEvents → broadcast
                                                   ↓
                          PostMessageTransport ──┤├── WebSocketTransport
                                 (VS Code)      (standalone browser)
```

The VS Code adapter wires `PostMessageTransport` against `acquireVsCodeApi()`. The standalone CLI exposes the same protocol over WebSocket at `/ws` with the webview SPA served from the same Fastify instance. **The protocol shape is identical; only the wire differs.**

Adding a new CLI integration is one subdirectory under `server/src/providers/hook/<id>/`: provider, optional `TeamProvider`, installer, hook scripts. Zero changes to the runtime, the UI, or any existing provider.

## Wire Protocol

`core/src/messages.ts` is the contract, hand-written and edited directly. Two
discriminated unions on `type`: `ServerMessage` (server → client) and
`ClientMessage` (client → server).

It used to be generated from `core/asyncapi.yaml`. That spec was removed
2026-07-19: nothing validated against it (the server sends plain objects into
`broadcast(Record<string, unknown>)`, the client casts what it receives), a
stale spec could silently drop fields on the next regeneration, and the
generator threw away every field description. The descriptions now live as
JSDoc in `messages.ts`, where they actually show up on hover.

## Transport Abstraction

```typescript
export interface MessageTransport {
  send(msg: ClientMessage): void;
  onMessage(handler: (msg: ServerMessage) => void): () => void;
  readonly ready: Promise<void>;
  readonly state: TransportState;
  onStateChange(handler: (state: TransportState) => void): () => void;
  dispose(): void;
}
export type TransportState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
```

`PostMessageTransport` reports `connected` for its entire lifetime. `WebSocketTransport` reconnects with exponential backoff (250 ms, 500 ms, 1 s, 2 s, 4 s, capped) and queues sends while disconnected.

`createTransport()` in `webview-ui/src/transport/index.ts` is the **only branching point** in the UI codebase. Everything downstream uses the `MessageTransport` interface and never knows which transport is active.

## Provider Abstraction

`HookProvider` (`core/src/provider.ts`) is the integration boundary. Today only Claude Code is implemented. The interface:

- **Required**: `normalizeHookEvent(raw)` → `{ sessionId, event: AgentEvent } | null`; `installHooks` / `uninstallHooks` / `areHooksInstalled`; `formatToolStatus`; `permissionExemptTools`, `subagentToolNames`, `readingTools` sets.
- **Optional file fallback**: `getSessionDirs(workspace)`, `getAllSessionRoots()`, `sessionFilePattern`, `parseTranscriptLine(line)`, `buildLaunchCommand(sessionId, cwd, opts)`. Used when hooks aren't installed.
- **Optional team extension**: `team?: TeamProvider` for Lead + Teammates support.

`AgentEvent.kind` values: `toolStart`, `toolEnd`, `turnEnd`, `subagentStart`, `subagentEnd`, `subagentTurnEnd`, `progress`, `permissionRequest`, `sessionStart`, `sessionEnd`. The runtime dispatches on `kind`, never on CLI-specific tool names.

### TeamProvider (Lead + Teammates)

Optional extension for CLIs that support team workflows (Claude Agent Teams today). Semantic queries (`discoverTeammates`, `getTeamMembers`, `getTeamMetadataForSession`, `extractTeammateNameFromEvent`, `isTeammateSpawnCall`) — providers choose their own storage strategy.

Three teammate modes:

| Mode                            | Trigger                                          | Detection                                                             |
| ------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| Basic subagent (teams OFF)      | `Task(...)` or `Agent(run_in_background: false)` | `subagentStart` with team gate not matched, or JSONL `agent_progress` |
| Inline teammate (teams ON)      | `Agent(run_in_background: true)` in-process      | `onTeammateDetected` → `discoverTeammates(projectDir, leadSessionId)` |
| Session teammate (teams + tmux) | `Agent(run_in_background: true)` in tmux pane    | Own session, own hooks, routes through normal flow                    |

Teammate dismissal is driven by team config polling (`getTeamMembers(teamName)` is authoritative) and by `sessionEnd` on the lead.

**Subtle gate (the one that bit us recently)**: in `webview-ui/src/hooks/useExtensionMessages.ts`, `agentToolStart` with `runInBackground=true` only creates a Subtask sub-character when the **parent has no `teamName`**. With a team, `onTeammateDetected` creates the teammate instead (and the gate prevents a ghost sub-agent). Without a team, the teammate path never fires and the basic Subtask sub-character is the only visible representation.

## Server Runtime

`AgentRuntime` (`server/src/agentRuntime.ts`) is the shared lifecycle core. Both surfaces (`adapters/vscode/PixelAgentsViewProvider.ts` and `server/src/cli.ts`) compose the same runtime; only the `StateAdapter` namespace, `MessageTransport`, and `TerminalAdapter` differ.

```typescript
export class AgentRuntime {
  constructor(opts: {
    store: AgentStateStore;
    providerRegistry: ProviderRegistry;
    layoutPersistence: LayoutPersistence;
    assetCache: AssetCache;
    config: Pick<AdapterSettings, 'hooksEnabled' | 'watchAllSessions'>;
    terminalAdapter?: TerminalAdapter;
    callbacks: RuntimeLifecycleCallbacks;
  });
  registerAgent / unregisterAgent / removeAgent / removeTeammate / removeTeammates
  restoreExternalAgents / handleHookEvent
  startProjectScan / startExternalScanning / startStaleCheck
  dispose();
}
```

Owns timer Maps (waiting, permission, text-idle, stale), scanners (project-dir 1 s, external 3 s, stale 30 s), `HookEventHandler`, `SessionRouter`, `DismissalTracker`. Scanners are skipped entirely while hooks are flowing (`hookDelivered` is set on every agent). `RuntimeLifecycleCallbacks` is the only seam between runtime and host.

### AgentStateStore

EventEmitter-backed container in `server/src/agentStateStore.ts`. Typed mutations, typed events (`agentAdded`, `agentRemoved`, `agentUpdated`, `broadcast`). The broadcast layer subscribes once at boot and translates `StoreEvents` into `ServerMessage` over the active transport. **No module under `server/` calls a transport method directly.**

### SessionRouter and DismissalTracker

Two extracted classes that replaced ad-hoc module state. `SessionRouter` owns `session_id → agent_id` mapping, pre-registration event buffering, and pending external sessions. `DismissalTracker` unifies four legacy globals (`dismissedJsonlFiles`, `clearDismissedFiles`, `seededMtimes`, `pendingClearFiles`) into one class with typed reasons.

### HTTP + WebSocket Server

Fastify v5 with `@fastify/cors`, `@fastify/websocket`, and (in standalone) `@fastify/static`:

| Method | Path                     | Purpose                                 |
| ------ | ------------------------ | --------------------------------------- |
| POST   | `/api/hooks/:providerId` | Bearer-authenticated hook event ingress |
| GET    | `/api/health`            | Liveness: `{ ok, version, port, pid }`  |
| GET    | `/ws`                    | Bidirectional protocol channel          |
| GET    | `/*` (standalone only)   | Webview SPA via `@fastify/static`       |

Server discovery written to `~/.pixel-agents/server.json` with `{ port, pid, authToken }`. Multi-window safe: a second server detects an existing `server.json` and reuses or replaces it based on PID liveness.

**`/ws` auth is asymmetric, and no first-party client sends a token.** The Bearer check in
`registerWebSocketRoute` sits inside `if (options.embedded)` — but embedded mode is VS Code,
where the webview talks over `PostMessageTransport`, not WebSocket (`transport/index.ts`), and
nothing under `adapters/vscode/` opens `/ws` at all. Standalone is the mode that actually uses
`/ws`, and there `embedded: false` skips the token check entirely; the browser client sends no
token either (`new WebSocket(this.url)`, no header, no localStorage). So the token branch guards
only third-party callers in a mode our own client doesn't use, and the mode our client does use
has just the Origin check — which `isAllowedWsOrigin` passes when the header is absent, i.e. for
any non-browser caller. That is the gap the README's "다른 기기에서 접속하기" section describes;
closing it means token-on-`/ws`, which needs a query param or subprotocol since the browser
WebSocket API cannot set headers.

Do not confuse this token with the AI credentials the onboarding wizard collects — different
thing entirely, covered by `setupCheck` / `clientMessageHandlerOnboarding` / `aiProvider`.

`server.test.ts` connects to `/ws` for real (Node 22+ built-in `WebSocket`, whose non-standard
`headers` option is what makes Origin/Authorization settable) and asserts 4003 / 4001 / accepted.
The pure-function tests in `httpServer.test.ts` cannot prove the route actually calls the guards.

### ClientMessageHandler

Single dispatch point for `ClientMessage`. Each variant calls into `AgentRuntime`, `AgentStateStore`, `LayoutPersistence`, or `FileStateAdapter`, or delegates to host-specific callbacks (`onLaunchAgent`, `onOpenSessionsFolder`, `onExportLayout`, `onImportLayout`, `onSetHooksEnabled`). Both surfaces wire the same handler.

### ServerAgentState (server/src/types.ts)

Per-agent runtime data: provider reference, session key, transcript-fallback fields (`jsonlFile`, `fileOffset`, `lineBuffer`), tool state Maps and Sets, team fields (`teamName`, `agentName`, `isTeamLead`, `leadAgentId`, `teamUsesTmux`), token usage, and the **`hookDelivered`** flag that suppresses heuristic timers when hooks are flowing.

## Persistence

```
~/.pixel-agents/
  config.json              { vscode, standalone, externalAssetDirectories }
  vscode-state.json        { agents, seats }
  standalone-state.json    { agents, seats }
  layout.json              OfficeLayout (shared across surfaces)
  server.json              { port, pid, authToken }
  hooks/claude-hook.js     Bundled hook script (CJS, shebang)
```

`FileStateAdapter({ namespace })` backs both runtimes. Per-namespace settings: `soundEnabled`, `lastSeenVersion`, `alwaysShowLabels`, `watchAllSessions`, `hooksEnabled`, `hooksInfoShown`, `onboardingDone`. Running both surfaces in parallel never clobbers either.

### Onboarding & setup diagnostics

Standalone-only (`isBrowserRuntime`) first-run wizard (`webview-ui/src/components/OnboardingWizard.tsx`): pick an AI (subscription vs. apiKey via `ProviderPicker`), run prerequisite checks, then optionally hire a first employee (role `lead`). Reachable again anytime via Settings → "연결 진단 / 온보딩 다시 보기".

Diagnostics are a separate protocol pair from the older `requestDiagnostics`/`agentDiagnostics` (agent connection dumps): the client sends `runSetupCheck` (`mode?: AuthMode`, defaults to the office's current mode), and the server answers `setupCheckResult` (`{ mode, checks: SetupCheck[] }`) **to that client only** — never broadcast, since two clients could be checking different modes concurrently. Each `SetupCheck` is `{ id, status, detail? }`:

- `id`: `claudeInstalled` / `claudeLoggedIn` (subscription) or `apiKeyFormat` / `apiKeyValid` (apiKey)
- `status`: `ok` / `fail` / `skip` (skip = an earlier check in the same mode already failed)
- `detail`: raw evidence (CLI version, last stderr line, HTTP status) — no user-facing wording. Korean remediation copy lives entirely in the webview (`setupCheckCopy.ts`), never on the wire.

`server/src/setupCheck.ts` runs the actual probes via `server/src/claudeCli.ts` (`runClaudeCli` — the shared `spawn('claude', ...)` helper `usageProbe.ts` also uses). Subscription checks run in the environment `buildEnv({mode:'subscription'})` produces (strips `ANTHROPIC_API_KEY`/`CLAUDE_CODE_OAUTH_TOKEN`) so a key sitting in the server host's own environment can't make `claudeLoggedIn` false-pass. The apiKey validity check is a `GET /v1/models?limit=1` — zero tokens, zero dollars, just enough to tell a live key (200) from a dead one (401/403) — deliberately not a `/v1/messages` call (would risk billing a stranger's card on first run, and a hardcoded model id can 404 on a valid key/tier).

`SetOnboardingDone { done }` persists `onboardingDone` (`false` reopens the wizard). `OfficeNotice { level, text }` is broadcast to every client — it replaces failures that used to be swallowed by a bare `console.error` (a `hireEmployee`/`clockIn` rejection, or an employee's session dying immediately after hire, which in practice is what a bad key/login looks like).

`migrateVsCodeState` (VS Code adapter only) walks each known legacy key once with **verify-before-clear** semantics: write to file, read back, only then clear the legacy key. While anything remains unmigrated, activation shows a non-blocking warning.

Layout writes are atomic via tmp + rename. Cross-window watching is hybrid (`fs.watch` + 2 s polling). `markOwnWrite()` prevents the watcher from re-reading our own write.

## Agent Status Tracking

JSONL transcripts at `~/.claude/projects/<project-hash>/<session-id>.jsonl`. Project hash = workspace path with `:`/`\`/`/` → `-`.

**JSONL record types**: `assistant` (tool_use or thinking), `user` (tool_result or text prompt), `system` with `subtype: "turn_duration"` (reliable turn-end signal), `progress` with `data.type`: `agent_progress` (sub-agent tool_use/tool_result, non-exempt tools trigger permission timers), `bash_progress` (Bash output — restarts permission timer), `mcp_progress` (MCP tool — same timer restart). Also observed but not tracked: `file-history-snapshot`, `queue-operation`.

**File watching**: 500 ms polling with partial-line buffering for mid-write reads. Tool-done messages delayed 300 ms to prevent React batching from hiding brief active states.

### Dual-mode detection

| Mode                     | Source                                                 | Detection                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Hooks** (preferred)    | Claude Code Hooks API → HTTP POST → `HookEventHandler` | Instant, reliable. 11 events: `SessionStart`, `SessionEnd`, `Stop`, `PermissionRequest`, `Notification`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `SubagentStart`, `SubagentStop` |
| **Heuristic** (fallback) | Polling JSONL files                                    | Per-agent 500 ms JSONL polling for /clear detection; 1 s main scanner for terminal adoption; 3 s external scanner; 30 s stale check. Content-based /clear detection (`/clear</command-name>` in first 8 KB)     |

The `hookDelivered` flag (per agent) and `hooksEnabled` (global) gate timer logic. JSONL polling always runs in both modes for tool content (status text, animations); only permission (7 s) and text-idle (5 s) timers are suppressed by `hookDelivered`.

### Sub-agent permission detection (heuristic)

When a sub-agent runs a non-exempt tool, `startPermissionTimer` fires on the parent agent. If `PERMISSION_TIMER_DELAY_MS` (7 s) elapses with no data, permission bubbles appear on both parent and sub-agent characters via `agentToolPermission` + `subagentToolPermission` broadcasts.

`activeSubagentToolNames: Map<parentToolId, Map<subToolId, toolName>>` tracks which sub-tools are active for the exempt check. Cleared when data resumes, Task completes, or `turn_duration` arrives.

**Timing budget for tests**: the test waits for the bubble AFTER waiting for the "Subtask:" overlay. But the Subtask overlay appears when the parent's **Task tool_use** is parsed (scenario time T), while the timer only starts when the **sub-tool tool_use** in the progress record is parsed (~1 s later). Plus 7 s timer + 300 ms IPC/render slop = a wait timeout less than ~10 s is unsafe.

## Office UI

**Rendering**: Game state in imperative `OfficeState` class (not React state). Pixel-perfect: zoom = integer device-pixels-per-sprite-pixel (1x–10x). No `ctx.scale(dpr)`. Default zoom = `Math.round(2 * devicePixelRatio)`. Z-sort all entities by Y. Pan via middle-mouse drag (`panRef`). **Camera follow**: `cameraFollowId` (separate from `selectedAgentId`) smoothly centers camera on the followed agent; set on agent click, cleared on deselection or manual pan.

**UI styling**: Pixel art aesthetic — sharp corners (`borderRadius: 0`), solid backgrounds (`#1e1e2e`), `2px solid` borders, hard offset shadows (`2px 2px 0px #0a0a14`, no blur). CSS variables in `index.css` `:root` (`--pixel-bg`, `--pixel-border`, `--pixel-accent`, ...). Pixel font: FS Pixel Sans (`webview-ui/src/fonts/`), loaded via `@font-face`, applied globally.

Custom ESLint rules (`eslint-rules/pixel-agents-rules.mjs`) enforce: `no-inline-colors` (hex/rgb/rgba/hsl/hsla literals only in `constants.ts`), `pixel-shadow` (must use `var(--pixel-shadow)` or `2px 2px 0px`), `pixel-font` (must reference FS Pixel Sans). All `error`-level — they block PRs.

**Characters**: FSM states — active (pathfind to seat, typing/reading animation by tool type), idle (wander randomly with BFS, return to seat after `wanderLimit` moves). 4-directional sprites, left = flipped right. Tool animations: typing (Write/Edit/Bash/Task) vs reading (Read/Grep/Glob/WebFetch). Sitting offset: characters shift down 6 px in TYPE state. Z-sort uses `ch.y + TILE_SIZE/2 + 0.5` so characters render in front of same-row furniture but behind lower-row furniture. **Chair z-sorting**: non-back chairs use `zY = (row+1)*TILE_SIZE` (capped to first row); back-facing chairs use `zY = (row+1)*TILE_SIZE + 1` so the chair back renders in front of the character. Chair tiles are blocked for all characters except their own assigned seat (per-character pathfinding via `withOwnSeatUnblocked`).

**Diverse palette assignment**: `pickDiversePalette()` counts palettes of current non-sub-agent characters; picks randomly from least-used palette(s). First 6 agents each get a unique skin; beyond 6, skins repeat with a random hue shift (45–315°) via `adjustSprite()`. Character stores `palette` (0-5) + `hueShift` (degrees). Sprite cache keyed by `"palette:hueShift"`.

**Spawn/despawn effect**: Matrix-style digital rain animation (0.3 s). 16 vertical columns sweep top-to-bottom with staggered timing. Spawn: green rain reveals character pixels. Despawn: character pixels consumed by green rain trails. `matrixEffect` field on Character (`'spawn'`/`'despawn'`/`null`). Normal FSM is paused during effect. Restored agents (`existingAgents`) use `skipSpawnEffect: true` to appear instantly.

**Sub-agents**: Negative IDs (from -1 down). Created on `agentToolStart` with "Subtask:" prefix. Same palette + hueShift as parent. Click focuses parent terminal. Not persisted. Spawn at closest free seat to parent (Manhattan distance); fallback: closest walkable tile.

**Speech bubbles**: Permission ("..." amber dots) stays until clicked/cleared. Waiting (green checkmark) auto-fades 2 s. Sprites in `spriteData.ts`.

**Sound notifications**: Ascending two-note chime (E5 → E6) via Web Audio API plays when waiting bubble appears (`agentStatus: 'waiting'`). `notificationSound.ts` manages AudioContext lifecycle; `unlockAudio()` on canvas mousedown resumes the context (webviews start suspended). Toggled via Settings modal. Persisted per-namespace in `~/.pixel-agents/config.json`.

**Seats**: Derived from chair furniture. `layoutToSeats()` creates a seat at every footprint tile of every chair. Multi-tile chairs produce multiple seats keyed `uid` / `uid:1` / `uid:2`. Facing direction priority: 1) chair `orientation` from catalog (front→DOWN, back→UP, left→LEFT, right→RIGHT), 2) adjacent desk direction, 3) forward (DOWN). Click character → select (white outline) → click available seat → reassign.

## Layout Editor

Toggle via "Layout" button. Tools: SELECT (default), Floor paint, Wall paint, Erase (set tiles to VOID), Furniture place, Furniture pick (eyedropper for furniture type), Eyedropper (floor).

**Floor**: 7 patterns from `floors.png` (grayscale 16×16), colorizable via HSBC sliders (Photoshop Colorize). Color baked per-tile on paint. Eyedropper picks pattern+color.

**Walls**: Separate Wall paint tool. Click/drag to add walls; click/drag existing walls to remove (toggle direction set by first tile of drag, tracked by `wallDragAdding`). HSBC color sliders (Colorize mode) apply to all wall tiles at once. Eyedropper on a wall tile picks its color and switches to Wall tool. Furniture cannot be placed on wall tiles, but background rows may overlap walls.

**Furniture**: Ghost preview (green/red validity). R key rotates, T key toggles on/off state. Drag-to-move in SELECT. Delete button (red X) + rotate button (blue arrow) on selected items. Any selected furniture shows HSBC color sliders (Color toggle + Clear button); color stored per-item in `PlacedFurniture.color?`. Single undo entry per color-editing session (tracked by `colorEditUidRef`). Pick tool copies type+color from placed item. Surface items preferred when clicking stacked furniture.

**Undo/Redo**: 50-level, Ctrl+Z/Y. EditActionBar (top-center when dirty): Undo, Redo, Save, Reset.

**Multi-stage Esc**: exit furniture pick → deselect catalog → close tool tab → deselect furniture → close editor.

**Erase tool**: Sets tiles to `TileType.VOID` (transparent, non-walkable, no furniture). Right-click in floor/wall/erase tools also erases to VOID (drag-erasing supported). Context menu suppressed in edit mode.

**Grid expansion**: In floor/wall/erase tools, a ghost border (dashed outline) appears 1 tile outside the grid. Clicking a ghost tile calls `expandLayout()` to grow the grid by 1 tile in that direction. New tiles are VOID. Furniture positions and character positions shift when expanding left/up. Max: `MAX_COLS`×`MAX_ROWS` (64×64). Default: `DEFAULT_COLS`×`DEFAULT_ROWS` (20×11). Characters outside bounds after resize relocated to random walkable tiles.

**Layout model**: `{ version: 1, cols, rows, tiles: TileType[], furniture: PlacedFurniture[], tileColors?: ColorValue[] }`. Grid dimensions are dynamic. Persisted via debounced saveLayout message → `writeLayoutToFile()` → `~/.pixel-agents/layout.json`.

## Asset System

**Loading**: `esbuild.js` copies `webview-ui/public/assets/` → `dist/assets/`. Loader checks bundled path first, falls back to workspace root. PNG → pngjs → SpriteData (2D hex array, alpha≥2 = visible, `#RRGGBBAA` for semi-transparent). `loadDefaultLayout()` reads `assets/default-layout.json` as fallback for new workspaces.

**Catalog**: `furniture-catalog.json` with `id, name, label, category, footprint, isDesk, canPlaceOnWalls, groupId?, orientation?, state?, canPlaceOnSurfaces?, backgroundTiles?`. String-based type system. Categories: desks, chairs, storage, electronics, decor, wall, misc. Wall-placeable items use the `wall` category and appear in a dedicated "Wall" tab. Asset naming convention: `{BASE}[_{ORIENTATION}][_{STATE}]` (e.g., `MONITOR_FRONT_OFF`).

**Per-furniture manifests**: Each furniture item lives in its own folder under `assets/furniture/` with a `manifest.json` that declares its sprites, rotation groups, state groups (on/off), and animation frames. Floor tiles are individual PNGs in `assets/floors/`; wall tile sets in `assets/walls/`.

**Rotation groups**: `buildDynamicCatalog()` builds `rotationGroups` Map from assets sharing a `groupId`. Supports 2+ orientations (e.g., front/back only). Editor palette shows 1 item per group (front orientation preferred). `getRotatedType()` cycles through available orientations.

**State groups**: Items with `state: "on"` / `"off"` sharing the same `groupId` + `orientation` form toggle pairs. `stateGroups` Map enables `getToggledType()` lookup. Editor palette hides on-state variants. State groups are mirrored across orientations.

**Auto-state**: `officeState.rebuildFurnitureInstances()` swaps electronics to ON sprites when an active agent faces a desk with that item nearby (3 tiles deep in facing direction, 1 tile to each side). Operates at render time without modifying the saved layout.

**Background tiles**: `backgroundTiles?: number` — top N footprint rows allow other furniture to be placed on them AND characters to walk through. Z-sort places bg-row items behind the host furniture.

**Surface placement**: `canPlaceOnSurfaces?: boolean` — items like laptops, monitors, mugs can overlap with all tiles of `isDesk` furniture. `canPlaceFurniture()` builds a desk-tile set and excludes it from collision checks. Z-sort: surface items get `zY = max(spriteBottom, deskZY + 0.5)`.

**Wall placement**: `canPlaceOnWalls?: boolean` — items like paintings, windows, clocks can only be placed on wall tiles. `canPlaceFurniture()` requires the bottom row of the footprint to be on wall tiles; upper rows may extend above the map. `getWallPlacementRow()` offsets placement so the bottom row aligns with the hovered tile.

**Colorize module**: `colorize.ts` with two modes selected by `ColorValue.colorize?` flag. **Colorize mode** (Photoshop-style): grayscale → luminance → contrast → brightness → fixed HSL; always used for floor tiles. **Adjust mode** (default for furniture and character hue shifts): shifts original pixel HSL. `adjustSprite()` exported for character hue shifts. Cache keyed by arbitrary string (includes colorize flag).

**Floor tiles**: `floors.png` (112×16, 7 patterns). Cached by (pattern, h, s, b, c).

**Wall tiles**: `walls.png` (64×128, 4×4 grid of 16×32 pieces). 4-bit auto-tile bitmask (N=1, E=2, S=4, W=8). Sprites extend 16 px above tile (3D face). `wallTiles.ts` computes bitmask at render time. Colorizable via HSBC sliders. Wall sprites z-sorted with furniture/characters (`getWallInstances()` builds `FurnitureInstance[]`).

**Character sprites**: 6 pre-colored PNGs (`assets/characters/char_0.png`–`char_5.png`), one per palette. Each 112×96: 7 frames × 16 px wide, 3 direction rows × 32 px tall. Row 0 = down, Row 1 = up, Row 2 = right. Frame order: walk1, walk2, walk3, type1, type2, read1, read2. Left = flipped right at runtime. When `hueShift !== 0`, `hueShiftSprites()` applies `adjustSprite()` to all frames before caching.

**Load order**: `characterSpritesLoaded` → `floorTilesLoaded` → `wallTilesLoaded` → `furnitureAssetsLoaded` → `layoutLoaded`.

## Testing

Three tiers, each with its own framework.

### Server unit/integration (Vitest)

`server/__tests__/` — 13 files, ~200 tests:

| File                           | Coverage                                                            |
| ------------------------------ | ------------------------------------------------------------------- |
| `agentStateStore.test.ts`      | Mutations, EventEmitter events, snapshot                            |
| `hookEventHandler.test.ts`     | Routing, buffering, normalized dispatch, team gating                |
| `sessionRouter.test.ts`        | session_id mapping, pending sessions, buffer flush                  |
| `fileWatcherDismissal.test.ts` | DismissalTracker integration                                        |
| `fileStateAdapter.test.ts`     | Namespaced persistence, allowlist, settings round-trip              |
| `migrateVsCodeState.test.ts`   | Verify-before-clear, partial migration                              |
| `teamUtils.test.ts`            | Inline-teammate helpers                                             |
| `claudeTeamProvider.test.ts`   | Discovery, membership, metadata extraction                          |
| `claude.test.ts`               | `normalizeHookEvent` per Claude event, file fallback                |
| `claudeHookInstaller.test.ts`  | Atomic install/uninstall                                            |
| `claude-hook.test.ts`          | Spawned hook script integration (needs `dist/hooks/claude-hook.js`) |
| `server.test.ts`               | HTTP lifecycle, auth, list-dir, `/ws` guard wiring                  |

Run: `npm run test:server` (or `npm test` for all).

### Webview unit (Vitest, Node runner)

`webview-ui/test/` — 16 files. Two are upstream's build smoke tests (`build-subpath`,
`dev-assets`); the rest cover this fork's logic (`boardEntries`, `dashboardModel`,
`permissionQueue`, `allowlistEntry`, `teamScaffoldPreview`, `jobPresets`,
`chatWindowPosition`, `folderPicker`, `toolSummary`, `setupCheckCopy`, ...).

Run: `npm run test:webview`.

### End-to-end — removed (2026-07-20)

**There is no e2e suite.** The Playwright suite inherited from upstream (51 tests, 27 files)
was deleted, along with `scripts/run-e2e.mjs`, `scripts/generate-e2e-inventory.mjs`, the
`e2e*` npm scripts, `@playwright/test`, and `@vscode/test-electron`.

Why, in the order the reasons were found:

1. **It was 100% red and nobody knew.** Nothing ran it — CI was deleted 2026-07-13 and the
   pre-push hook only regenerated the inventory. Every test failed in the fixture, waiting
   30 s for a `"+ Agent"` button that is `"+ 에이전트"` here. Korean localization broke it and
   the breakage went unnoticed because the suite was never executed.
2. **Repair was not a string swap.** Past the fixture came four more layers: the settings
   modal, its four checkboxes, `Layout`/`Save`, then ~25 distinct overlay strings. Word order
   reverses (`Reading foo.ts` → `foo.ts 읽는 중`), so each assertion needed hand-translation.
3. **49 of 51 tests launched real VS Code** — the surface this fork is folding — and tested
   upstream's features, not this fork's.
4. **This fork's features are already covered** by 29 test files added since the fork
   (18 under `server/__tests__/`, 11 under `webview-ui/test/`): employees, permissions and
   the allowlist, teams, the board, auth and onboarding. 704 tests, ~13 s, all green.

A permanently red suite is worse than no suite — it trains you to ignore red, which is how
the "9건은 원래 실패" baseline mistake happened before.

**If e2e comes back**, write it for this fork's own flows (hire → character appears,
approval card → click → resolved), not by reviving upstream's. Recover the old suite from
git history if it's ever useful: `git show 8171e42:e2e/playwright.config.ts` and siblings.

**Known leftover**: `webview-ui/src/testHooks.ts` (plus `__pixelAgentsTestHooks` writes in
`useExtensionMessages.ts` and `notificationSound.ts`) existed only for the e2e fixtures. It
is now dead weight, but it is woven into `App.tsx` and two more files, so it was left in
place rather than ripped out as part of the deletion.

## Build & Dev

**npm workspaces monorepo** (`server`, `webview-ui`). A single `npm install` at the root installs deps for all workspaces; `cd webview-ui && npm install` is redundant.

```bash
npm install                # installs root + workspaces in one shot
npm run compile            # check-types, lint, esbuild, vite
npm run build              # alias for compile
npm run package            # production build (esbuild --production)
npm test                   # webview + server vitest
```

`esbuild.js` runs three bundles:

1. **Extension** (`dist/extension.js`) from `adapters/vscode/extension.ts`. External: `vscode`.
2. **CLI** (`dist/cli.js`) from `server/src/cli.ts`. Externals pulled at install time (`fastify`, `@fastify/*`).
3. **Hook scripts** (`dist/hooks/claude-hook.js`) from `server/src/providers/hook/claude/hooks/claude-hook.ts`. CJS, shebang.

`define: { 'process.env.PIXEL_AGENTS_VERSION': JSON.stringify(version) }` stamps the package version into all bundles.

**Watch mode**:

```bash
npm run watch                       # parallel esbuild watch + tsc --noEmit watch
cd webview-ui && npm run dev        # Vite dev server (separate terminal)
```

The webview Vite dev server is **not** included in `npm run watch` — it has to be run separately.

**F5 in VS Code** launches the Extension Development Host with the local extension loaded.

### CI

`.github/workflows/ci.yml` — one job on `ubuntu-latest`, Node from `.nvmrc`, triggered on
push to `main` and on PRs (`.md`/`LICENSE`-only changes skipped). Steps: `npm ci`,
`check-types`, `lint`, `format:check`, `e2e:inventory` + drift check, `test:server`,
`test:webview`, then the two builds (`node esbuild.js --production`, `build:webview`).

Every check carries `if: always()` so one failure doesn't hide the rest — all steps run,
and the job fails if any did. The drift check keeps `e2e/README.md` in sync with the
spec list.

**e2e is deliberately not wired up yet.** The upstream workflow ran it as a 3-OS x 3-shard
matrix against a real VS Code Electron instance; that was dropped along with the rest of
upstream's CI on 2026-07-13 (commit `92f9182`) and has not been re-verified since. Adding
it before confirming it passes would bury the checks above in red. Verify locally
(`npm run e2e`) first, then add it as a separate job.

Two upstream steps are gone for good: `asyncapi:validate` and the generated-messages drift
check both referenced `core/asyncapi.yaml`, which was removed 2026-07-19 (see "Wire
Protocol"). Restoring the old workflow wholesale would fail on them.

## TypeScript Constraints

- **No `enum`** (`erasableSyntaxOnly` in webview) — use `as const` objects (`TileType`, `CharacterState`, `Direction`, `EditTool`).
- **`import type`** required for type-only imports (`verbatimModuleSyntax` in webview; convention in extension).
- **`noUnusedLocals` / `noUnusedParameters`** — strict everywhere.
- **`.js` extensions** on all relative imports in extension + server (Node16 module resolution).
- **Module Node16, target ES2022** in the extension/server. **`erasableSyntaxOnly`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`** in the webview.

## Constants Policy

All magic numbers and strings are centralized — never inline:

| Where                              | What lives there                                                                                                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/constants.ts`          | All timing/scanning constants (`PERMISSION_TIMER_DELAY_MS`, `TEXT_IDLE_DELAY_MS`, scanner intervals) shared by extension and standalone |
| `adapters/vscode/constants.ts`     | VS Code-only IDs, command names, workspace state keys                                                                                   |
| `core/src/constants.ts`            | Protocol-level constants (e.g., transport state names)                                                                                  |
| `webview-ui/src/constants.ts`      | Webview magic numbers (grid, animation, rendering, camera, zoom, editor, game logic) + canvas overlay rgba strings                      |
| `webview-ui/src/index.css` `:root` | CSS custom properties (`--pixel-bg`, `--pixel-border`, `--pixel-accent`, ...) for React inline styles and CSS                           |
| `webview-ui/src/office/types.ts`   | Re-exports grid constants from `constants.ts` for convenience                                                                           |

## Error Handling

- **Try-catch with graceful degradation** — errors logged but never crash the extension.
- **Malformed JSONL lines** silently ignored (catch block in `processTranscriptLine`).
- **Missing assets** logged with warning, operation continues with null/fallback.
- No centralized error reporting or telemetry.

## Logging

Use `console.log`/`error`/`warn` with prefixed context:

- Extension: `[Pixel Agents]`, `[Extension]`
- Asset loading: `[AssetLoader]`
- Webview: `[Webview]`

## Condensed Lessons

- `fs.watch` unreliable on Windows — always pair with polling backup.
- Partial line buffering essential for append-only file reads (carry unterminated lines).
- Delay `agentToolDone` 300 ms to prevent React batching from hiding brief active states.
- **Idle detection** has two signals: (1) `system` + `subtype: "turn_duration"` — reliable for tool-using turns (~98%), emitted once per completed turn. (2) Text-idle timer (`TEXT_IDLE_DELAY_MS = 5 s`) — for text-only turns. Only starts when `hadToolsInTurn` is false; suppressed once `hadToolsInTurn` becomes true. Reset on new user prompt or `turn_duration`. Cancelled by ANY new JSONL data.
- User prompt `content` can be string (text) or array (tool_results) — handle both.
- `/clear` creates a NEW JSONL file (old file just stops).
- `--output-format stream-json` needs non-TTY stdin — can't use with VS Code terminals.
- Hook-based IPC failed in early prototypes (hooks captured at startup, env vars don't propagate). HTTP `/api/hooks/:providerId` with `~/.pixel-agents/server.json` discovery works.
- PNG→SpriteData: pngjs for RGBA buffer, alpha threshold 2 (`PNG_ALPHA_THRESHOLD`), supports `#RRGGBBAA` semi-transparent pixels.
- OfficeCanvas selection changes are imperative (`editorState.selectedFurnitureUid`); must call `onEditorSelectionChange()` to trigger React re-render for toolbar.
- **External-session adoption**: scanner runs every 3 s. In hooks-OFF mode external scenarios, the test setup can race the first scanner tick. Mock-claude scenarios should give a few seconds of margin before assertions.
- **Heuristic sub-agent permission bubble timing**: the bubble lands 7 s after the SUB-TOOL is registered, not 7 s after the parent Task tool appears. Tests waiting on it from the "Subtask:" overlay need at least `1 s (Task→Bash gap) + 7 s timer + ~300 ms IPC/render = 9–10 s` budget.
- **runInBackground sub-character gate**: in webview `agentToolStart`, `runInBackground=true` Agent tools are gated out of sub-character creation when the parent has a `teamName` (teammate path handles it). With no `teamName`, the gate must be bypassed so the basic Subtask sub-character still renders. `addSubagent` dedups via `subagentIdMap`, so the bypass is safe even if a teammate is detected later.

## Manual Hook Testing

`server/manual-hook-events.http` (REST-Client format) drives the local hook server while the extension is running. Copy `port` and `token` from `~/.pixel-agents/server.json`, set `cwd` to a workspace folder opened in the Extension Development Host. Covers `SessionStart` → `PreToolUse` → `PermissionRequest`/`Notification`/`Stop` → `SessionEnd`.

If `cwd` is outside the current workspace, enable **Watch All Sessions** first.

## Asset Pipeline (legacy tileset import)

7-stage pipeline in `scripts/` for importing third-party tilesets (the bundled assets don't need this):

1. `0-import-tileset.ts` — Interactive CLI wrapper
2. `1-detect-assets.ts` — Flood-fill asset detection
3. `2-asset-editor.html` — Browser UI for position/bounds editing
4. `3-vision-inspect.ts` — Claude vision auto-metadata
5. `4-review-metadata.html` — Browser UI for metadata review
6. `5-export-assets.ts` — Export PNGs + `furniture-catalog.json`
7. `asset-manager.html` — Unified editor (stages 2+4 combined), Save/Save As via File System Access API

Supporting: `wall-tile-editor.html` (wall sprite editing), `jsonl-viewer.html` (transcript inspector).

## Key Decisions

- **Four-package monorepo** with strict layering (core → server → adapters; core → webview-ui). Standalone CLI never imports `adapters/vscode/` and vice versa.
- **Hand-written wire protocol** in `core/src/messages.ts` — two discriminated unions, one file, edited directly.
- **AgentRuntime** shared lifecycle core, composed by both surfaces.
- **AgentStateStore** as single source of truth with typed mutations and typed events. No transport calls outside the broadcast layer.
- **Transport abstraction**: `MessageTransport` interface, `PostMessageTransport` + `WebSocketTransport`. One branching point in the entire UI.
- **HookProvider** as the integration boundary, with optional file fallback. New CLIs are a single subdirectory under `server/src/providers/hook/<id>/`.
- **TeamProvider** as optional extension. Claude Agent Teams is the only implementation.
- **Per-adapter namespaced persistence** under `~/.pixel-agents/`. VS Code and standalone never clobber each other.
- **Verify-before-clear migration** for legacy VS Code state.
- **Single `WebviewViewProvider`** (panel area, not editor area).
- **Inline esbuild problem matcher** (no extra extension needed).
- **`erasableSyntaxOnly`** in webview forbids `enum` — use `as const` objects.
- **Server always starts** regardless of hooks toggle. Only hook installation is gated by the setting.
- **Unit tests over e2e** (reverses upstream's call, 2026-07-20). Upstream chose e2e to spare
  community PRs from updating internals tests. This fork has no PR stream and folded the VS
  Code surface those tests drove, so the tradeoff inverted: 29 fast unit-test files covering
  this fork's own features beat 51 slow tests covering upstream's. See "End-to-end — removed".

## Project Identity

- Extension ID: `pablodelucca.pixel-agents` (VS Code Marketplace + Open VSX)
- npm package: `pixel-agents` (CLI bin: `pixel-agents`)
- GitHub: `https://github.com/pixel-agents-hq/pixel-agents`
- License: MIT
