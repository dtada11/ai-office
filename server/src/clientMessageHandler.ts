import type { EmployeeProvider } from '../../core/src/messages.js';
import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { isAuthMode, maskProvider, readOfficeProvider, writeOfficeProvider } from './aiProvider.js';
import type { LoadedAssets, LoadedCharacterSprites, LoadedPetSprites } from './assetLoader.js';
import { getConfiguredModel } from './claudeSettings.js';
import { readConfig, writeConfig } from './configPersistence.js';
import {
  allowlistKeyFor,
  clockIn,
  clockOut,
  fireEmployee,
  getPendingPermissionRequests,
  hireEmployee,
  isEmployee,
  listAllowlistTargets,
  listHandoffNotes,
  renameEmployee,
  resolveEmployeePermission,
  sendStaffTo,
  sendToEmployee,
  setEmployeeModelFor,
  setEmployeePersona,
  setEmployeeSeat,
} from './employees.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import { getLatestPlanUsage } from './planUsage.js';
import { claudeProvider } from './providers/index.js';
import { runSetupCheck } from './setupCheck.js';
import { killShellCommand, runShellCommand } from './shellRunner.js';
import {
  addPermission,
  hasDangerousBashMetachars,
  loadToolPermissions,
  removePermission,
} from './toolPermissions.js';

type WsSend = (message: Record<string, unknown>) => void;

/** Async hook toggle side effect (install/uninstall + script copy). Provided by cli.ts. */
export type SetHooksEnabledSideEffect = (enabled: boolean) => Promise<void> | void;

/** Cached assets loaded at server startup. Sent to each WebSocket client on webviewReady. */
export interface AssetCache {
  characters: LoadedCharacterSprites | null;
  pets: LoadedPetSprites | null;
  floorTiles: string[][][] | null;
  wallTiles: string[][][][] | null;
  furniture: LoadedAssets | null;
  defaultLayout: Record<string, unknown> | null;
}

export interface ClientMessageContext {
  store: AgentStateStore;
  runtime?: AgentRuntime;
  cache: AssetCache | null;
  /** Install/uninstall hooks side effect. Needs server url+token known only to cli.ts. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Re-calibrate the plan gauges from `/usage` and broadcast the result. */
  onRefreshPlanUsage?: () => Promise<void> | void;
}

// ── Setting key constants (mirror adapters/vscode/constants.ts) ──
const KEY_SOUND_ENABLED = 'pixel-agents.soundEnabled';
const KEY_LAST_SEEN_VERSION = 'pixel-agents.lastSeenVersion';
const KEY_ALWAYS_SHOW_LABELS = 'pixel-agents.alwaysShowLabels';
const KEY_WATCH_ALL_SESSIONS = 'pixel-agents.watchAllSessions';
const KEY_HOOKS_ENABLED = 'pixel-agents.hooksEnabled';
const KEY_HOOKS_INFO_SHOWN = 'pixel-agents.hooksInfoShown';
const KEY_ONBOARDING_DONE = 'pixel-agents.onboardingDone';

/**
 * Handle incoming ClientMessage from a WebSocket client.
 *
 * In standalone mode, the server is the authority for all state: assets,
 * layout, settings, agents. Assets are loaded once at startup and cached
 * in memory. Each connecting client receives the full state on webviewReady.
 */
export function handleClientMessage(
  msg: Record<string, unknown>,
  send: WsSend,
  ctx: ClientMessageContext,
): void {
  const { store, runtime } = ctx;
  const adapter = store.getAdapter();

  switch (msg.type) {
    case 'webviewReady':
      handleWebviewReady(send, ctx);
      sendStaffTo(store); // a fresh client needs to know who works here
      // ...and who is still waiting on an answer. Sent to this client only — a
      // broadcast would re-alert (and re-chime on) everyone already connected.
      for (const { agentId, ask } of getPendingPermissionRequests()) {
        send({ type: 'agentPermissionRequest', agentId, ...ask });
      }
      break;

    // The × over a character. Employees are exempt — their session would keep running
    // and their name would stay on the roster, so they come back on the next restart.
    // Firing them from the staff panel is the way to let an employee go.
    case 'closeAgent': {
      const id = msg.id as number;
      const agent = store.get(id);
      if (agent && runtime && !isEmployee(id)) {
        // Dismiss the transcript too, or the external scanner adopts it straight back.
        runtime.dismissalTracker.dismiss(agent.jsonlFile);
        runtime.removeAgent(id);
      }
      break;
    }

    case 'saveLayout':
      if (msg.layout) {
        const saved = writeLayoutToFile(msg.layout as Record<string, unknown>);
        if (!saved) {
          // The write failed (disk full, permissions). Tell the user now — a
          // silent failure leaves them believing the layout is saved when it
          // will roll back on the next restart.
          store.broadcast({
            type: 'officeNotice',
            level: 'error',
            text: '레이아웃 저장 실패 — 디스크 공간이나 권한을 확인하세요. 이 변경은 재시작 시 사라집니다.',
          });
        }
      }
      break;

    case 'saveAgentSeats':
      if (msg.seats) {
        const seats = msg.seats as Record<
          string,
          { palette?: number; hueShift?: number; seatId?: string }
        >;
        adapter?.saveSeats(seats);
        // Employees additionally freeze their look into the roster (keyed by
        // identity, not agentId) so it survives a restart or a fire/rehire
        // elsewhere on the roster. Terminal sessions have no roster entry —
        // setEmployeeSeat() is a no-op for them.
        for (const [agentIdStr, seat] of Object.entries(seats)) {
          const agentId = Number(agentIdStr);
          if (isEmployee(agentId)) {
            setEmployeeSeat(agentId, seat.palette, seat.hueShift);
          }
        }
      }
      break;

    case 'setSoundEnabled':
      adapter?.setSetting(KEY_SOUND_ENABLED, msg.enabled);
      break;

    case 'setLastSeenVersion':
      adapter?.setSetting(KEY_LAST_SEEN_VERSION, msg.version as string);
      break;

    case 'setAlwaysShowLabels':
      adapter?.setSetting(KEY_ALWAYS_SHOW_LABELS, msg.enabled);
      break;

    case 'setWatchAllSessions': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_WATCH_ALL_SESSIONS, enabled);
      if (runtime) runtime.watchAllSessions.current = enabled;
      break;
    }

    case 'setHooksEnabled': {
      const enabled = msg.enabled as boolean;
      adapter?.setSetting(KEY_HOOKS_ENABLED, enabled);
      if (runtime) runtime.hooksEnabled.current = enabled;
      void ctx.onSetHooksEnabled?.(enabled);
      break;
    }

    case 'setHooksInfoShown':
      adapter?.setSetting(KEY_HOOKS_INFO_SHOWN, true);
      break;

    case 'setOnboardingDone':
      adapter?.setSetting(KEY_ONBOARDING_DONE, msg.done as boolean);
      break;

    case 'runSetupCheck': {
      const mode = isAuthMode(msg.mode) ? msg.mode : readOfficeProvider().mode;
      runSetupCheck(mode)
        .then((checks) => send({ type: 'setupCheckResult', mode, checks }))
        .catch((err) => {
          console.error('[Pixel Agents] runSetupCheck failed:', err);
          const firstCheckId = mode === 'subscription' ? 'claudeInstalled' : 'apiKeyFormat';
          send({
            type: 'setupCheckResult',
            mode,
            checks: [{ id: firstCheckId, status: 'fail', detail: String(err) }],
          });
        });
      break;
    }

    case 'setAgentModel':
      setEmployeeModelFor(store, msg.agentId as number, msg.model as string);
      break;

    case 'renameEmployee':
      renameEmployee(store, msg.agentId as number, msg.roleLabel as string);
      break;

    case 'setEmployeePersona':
      setEmployeePersona(store, msg.agentId as number, msg.persona as string);
      break;

    case 'clockIn':
      void clockIn(store, msg.agentId as number, runtime).catch((err) => {
        console.error('[Pixel Agents] clock-in failed:', err);
        store.broadcast({
          type: 'officeNotice',
          level: 'error',
          text: '출근 실패: ' + String(err instanceof Error ? err.message : err),
        });
      });
      break;

    case 'clockOut':
      clockOut(store, msg.agentId as number, runtime);
      break;

    case 'addExternalAssetDirectory': {
      const newPath = msg.path as string | undefined;
      if (!newPath) break;
      const cfg = readConfig();
      if (!cfg.externalAssetDirectories.includes(newPath)) {
        cfg.externalAssetDirectories.push(newPath);
        writeConfig(cfg);
      }
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    case 'runShellCommand':
      runShellCommand(
        store,
        msg.execId as string,
        msg.command as string,
        msg.cwd as string | undefined,
      );
      break;

    case 'killShellCommand':
      killShellCommand(store, msg.execId as string);
      break;

    case 'hireEmployee':
      void hireEmployee(
        store,
        msg.name as string,
        msg.cwd as string,
        msg.role as 'lead' | 'staff',
        (msg.model as string | undefined) || getConfiguredModel(),
        runtime,
        msg.provider as EmployeeProvider | undefined,
        msg.roleLabel as string | undefined,
        msg.persona as string | undefined,
        undefined, // palette — brand-new interactive hire, not a rehire
        undefined, // hueShift — same
        msg.handoffFromKey as string | undefined,
        undefined, // savedPermissionKey — brand-new interactive hire, not a rehire
        msg.teamRoot as string | undefined,
      ).catch((err) => {
        console.error('[Pixel Agents] hire failed:', err);
        store.broadcast({
          type: 'officeNotice',
          level: 'error',
          text: '직원 고용 실패: ' + String(err instanceof Error ? err.message : err),
        });
      });
      break;

    case 'setOfficeProvider': {
      const current = readOfficeProvider();
      if (!isAuthMode(msg.mode)) {
        // Invalid mode: ignore the change and resend what is actually on file.
        send({ type: 'officeProvider', ...maskProvider(current) });
        break;
      }
      const mode = msg.mode;
      // A blank secret means "keep the one on file" — the client never gets the
      // stored value back, so it cannot resend it, and typing over it is the only
      // way to change it.
      const apiKey = (msg.apiKey as string | undefined)?.trim() || current.apiKey;
      const model = (msg.model as string | undefined) ?? current.model;
      const next = { mode, apiKey, model };
      writeOfficeProvider(next);
      send({ type: 'officeProvider', ...maskProvider(next) });
      console.log(`[Pixel Agents] Office AI set to ${mode} (applies to employees hired from now)`);
      break;
    }

    case 'fireEmployee':
      fireEmployee(store, msg.agentId as number, runtime, msg.deleteHandoff as boolean | undefined);
      break;

    case 'listHandoffNotes':
      send({
        type: 'handoffNotesListed',
        cwd: msg.cwd as string,
        notes: listHandoffNotes(msg.cwd as string),
      });
      break;

    case 'sendAgentMessage':
      sendToEmployee(store, msg.agentId as number, msg.text as string);
      break;

    case 'agentPermissionDecision':
      resolveEmployeePermission(store, msg.requestId as string, msg.allow as boolean);
      break;

    case 'addToAllowlist': {
      // The identity comes from the roster, never from the client. A key off the
      // wire would let anyone who can reach the port write into any employee's
      // allowlist — and this server can bind 0.0.0.0, where /ws accepts
      // Origin-less callers with no token.
      const key = allowlistKeyFor(msg.agentId as number);
      const toolName = msg.toolName as string | undefined;
      const match = msg.match as 'exact' | 'dirPrefix' | undefined;
      const value = msg.value as string | undefined;

      if (!key || !toolName || !match || !value) break;

      // Second gate. The button already refuses these, but the button is on the
      // other side of a socket — this side cannot assume it ran. Fail closed:
      // a command that could chain, substitute or redirect never becomes a
      // standing permission, because `ls; rm -rf /` in the file is permanent.
      if (toolName === 'Bash' && (match !== 'exact' || hasDangerousBashMetachars(value))) break;

      addPermission(key, {
        tool: toolName,
        match,
        value,
        addedAt: new Date().toISOString(),
      });
      break;
    }

    case 'listAllowlist':
      send(allowlistListedMessage());
      break;

    case 'removeFromAllowlist': {
      // Same rule as addToAllowlist above: the id names the employee, the server
      // says who that is. Trusting a key off the wire would let an unauthenticated
      // caller strip permissions off anyone — or, with a made-up key, silently
      // report success against a bucket nobody owns.
      const key = allowlistKeyFor(msg.agentId as number);
      const toolName = msg.toolName as string | undefined;
      const match = msg.match as string | undefined;
      const value = msg.value as string | undefined;

      if (!key || !toolName || !match || !value) break;

      removePermission(key, toolName, match, value);
      // Answer with the whole list rather than an ack: the panel then renders
      // what the file actually holds, so a delete that matched nothing (already
      // gone, stale client) can't leave a row on screen that no longer exists.
      send(allowlistListedMessage());
      break;
    }

    case 'refreshPlanUsage':
      void ctx.onRefreshPlanUsage?.();
      break;

    case 'removeExternalAssetDirectory': {
      const removePath = msg.path as string | undefined;
      if (!removePath) break;
      const cfg = readConfig();
      cfg.externalAssetDirectories = cfg.externalAssetDirectories.filter((d) => d !== removePath);
      writeConfig(cfg);
      send({ type: 'externalAssetDirectoriesUpdated', dirs: cfg.externalAssetDirectories });
      break;
    }

    default:
      // focusAgent, exportLayout, importLayout
      // require IDE-specific handling (not yet implemented for standalone)
      break;
  }
}

/** The roster joined to the permissions file, for the settings panel.
 *
 *  Everyone on the roster appears, including those with nothing allowed — the
 *  panel is answering "what have I auto-allowed?", and an employee omitted for
 *  having an empty list is indistinguishable from one who was never hired.
 *
 *  Permissions filed under a key no current employee resolves to (someone who
 *  was fired) are left out: nothing on the roster claims them, so there is no
 *  name to file them under and no agentId to delete them by. */
function allowlistListedMessage(): Record<string, unknown> {
  const data = loadToolPermissions();
  return {
    type: 'allowlistListed',
    employees: listAllowlistTargets().map(({ agentId, name, key }) => ({
      agentId,
      name,
      allow: data.byEmployee[key]?.allow ?? [],
    })),
  };
}

function handleWebviewReady(send: WsSend, ctx: ClientMessageContext): void {
  const { store, runtime, cache } = ctx;
  const adapter = store.getAdapter();

  // 1. Provider capabilities (must arrive before any agent messages)
  send({
    type: 'providerCapabilities',
    readingTools: [...claudeProvider.readingTools],
    subagentToolNames: [...claudeProvider.subagentToolNames],
  });

  // 2. Assets (from server cache, loaded at startup via pngjs)
  if (cache) {
    if (cache.characters) {
      send({ type: 'characterSpritesLoaded', characters: cache.characters.characters });
    }
    if (cache.pets) {
      send({
        type: 'petSpritesLoaded',
        pets: cache.pets.pets,
        petNames: cache.pets.manifests.map((m) => m.name),
      });
    }
    if (cache.floorTiles) {
      send({ type: 'floorTilesLoaded', sprites: cache.floorTiles });
    }
    if (cache.wallTiles) {
      send({ type: 'wallTilesLoaded', sets: cache.wallTiles });
    }
    if (cache.furniture) {
      send({
        type: 'furnitureAssetsLoaded',
        catalog: cache.furniture.catalog,
        sprites: Object.fromEntries(cache.furniture.sprites),
      });
    }
  }

  // 3. Layout (saved file, or bundled default)
  const savedLayout = readLayoutFromFile();
  send({ type: 'layoutLoaded', layout: savedLayout ?? cache?.defaultLayout ?? null });

  // 4. Settings (from adapter, with sensible defaults when adapter is absent)
  const cfg = readConfig();
  const watchAllSessions = adapter?.getSetting(KEY_WATCH_ALL_SESSIONS, false) ?? false;
  const hooksEnabled = adapter?.getSetting(KEY_HOOKS_ENABLED, true) ?? true;
  const onboardingDone = adapter?.getSetting(KEY_ONBOARDING_DONE, false) ?? false;
  const extensionVersion = process.env.PIXEL_AGENTS_VERSION ?? '';

  // First-impression bug: a brand-new user has never seen ANY version, but
  // lastSeenVersion defaults to '' — which VersionIndicator reads as "behind
  // the current version" and greets them with "업데이트됨!" on their very
  // first launch. Once onboarding exists, "never onboarded" is the reliable
  // signal for "this is a new install": back-fill lastSeenVersion with the
  // current version so the update notice stays reserved for actual updates.
  let lastSeenVersion = adapter?.getSetting(KEY_LAST_SEEN_VERSION, '') ?? '';
  if (!onboardingDone && lastSeenVersion === '' && extensionVersion) {
    lastSeenVersion = extensionVersion;
    adapter?.setSetting(KEY_LAST_SEEN_VERSION, extensionVersion);
  }

  send({
    type: 'settingsLoaded',
    soundEnabled: adapter?.getSetting(KEY_SOUND_ENABLED, true) ?? true,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    alwaysShowLabels: adapter?.getSetting(KEY_ALWAYS_SHOW_LABELS, false) ?? false,
    hooksEnabled,
    hooksInfoShown: adapter?.getSetting(KEY_HOOKS_INFO_SHOWN, false) ?? false,
    externalAssetDirectories: cfg.externalAssetDirectories,
    onboardingDone,
  });

  // 4a. The office's AI, masked — the client shows which one is plugged in.
  send({ type: 'officeProvider', ...maskProvider(readOfficeProvider()) });

  // 4b. Plan usage gauges (latest computed tick, if any — refreshed every minute)
  const planUsage = getLatestPlanUsage();
  if (planUsage) send(planUsage as unknown as Record<string, unknown>);

  // Sync runtime refs with the persisted settings so scanners behave correctly
  // from the first tick after a server restart.
  if (runtime) {
    runtime.watchAllSessions.current = watchAllSessions;
    runtime.hooksEnabled.current = hooksEnabled;
  }

  // 5. Restore persisted external agents (standalone only; VS Code handles its own restore)
  runtime?.restoreExternalAgents();

  // 6. Existing agents (either just restored, or from VS Code adapter if present)
  const agentIds: number[] = [];
  const folderNames: Record<number, string> = {};
  const externalAgents: Record<number, boolean> = {};
  for (const [id, agent] of store) {
    agentIds.push(id);
    if (agent.folderName) {
      folderNames[id] = agent.folderName;
    }
    if (agent.isExternal) {
      externalAgents[id] = true;
    }
  }
  const seats = adapter?.loadSeats() ?? {};
  send({
    type: 'existingAgents',
    agents: agentIds,
    agentMeta: seats,
    folderNames,
    externalAgents,
  });
}
