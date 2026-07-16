#!/usr/bin/env node

/**
 * Standalone CLI entry point: `npx pixel-agents`
 *
 * Starts the Fastify server in standalone mode with SPA serving and WebSocket.
 * Loads all assets (PNGs -> SpriteData) on startup and caches in memory.
 * Each connecting WebSocket client receives the full state on webviewReady.
 */

import * as path from 'path';

import { AgentRuntime } from './agentRuntime.js';
import { AgentStateStore } from './agentStateStore.js';
import { readOfficeProvider } from './aiProvider.js';
import {
  loadCharacterSprites,
  loadDefaultLayout,
  loadFloorTiles,
  loadFurnitureAssets,
  loadPetSprites,
  loadWallTiles,
} from './assetLoader.js';
import { getConfiguredModel } from './claudeSettings.js';
import type { AssetCache } from './clientMessageHandler.js';
import { disposeEmployees, rehireSavedEmployees } from './employees.js';
import { FileStateAdapter } from './fileStateAdapter.js';
import { PlanUsageTracker } from './planUsage.js';
import { claudeProvider, copyHookScript } from './providers/index.js';
import { PixelAgentsServer } from './server.js';
import { disposeShellRunner } from './shellRunner.js';
import { refreshPlanSnapshot } from './usageProbe.js';

// ── Argument parsing ──────────────────────────────────────────

interface CliArgs {
  port: number;
  host: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { port: 3100, host: '127.0.0.1' };
  for (let i = 0; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      args.port = parseInt(argv[i + 1], 10);
      i++;
    } else if (argv[i] === '--host' && argv[i + 1]) {
      args.host = argv[i + 1];
      i++;
    } else if (argv[i] === '--help') {
      console.log(`Usage: pixel-agents [options]

Options:
  --port, -p <number>   Port to listen on (default: 3100)
  --host <string>       Host to bind to (default: 127.0.0.1)
  --help                Show this help message`);
      process.exit(0);
    }
  }
  return args;
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // dist/ contains both the CLI bundle and the assets/ + webview/ directories
  const distRoot = __dirname;
  const staticDir = path.join(distRoot, 'webview');

  // ── Load assets on startup (same pipeline as VS Code extension) ──
  console.log('[Pixel Agents] Loading assets...');
  const assetCache: AssetCache = {
    characters: await loadCharacterSprites(distRoot),
    pets: await loadPetSprites(distRoot),
    floorTiles: await loadFloorTiles(distRoot).then((t) => t?.sprites ?? null),
    wallTiles: await loadWallTiles(distRoot).then((t) => t?.sets ?? null),
    furniture: await loadFurnitureAssets(distRoot),
    defaultLayout: loadDefaultLayout(distRoot),
  };
  const charCount = assetCache.characters?.characters.length ?? 0;
  const petCount = assetCache.pets?.pets.length ?? 0;
  const furnitureCount = assetCache.furniture?.catalog.length ?? 0;
  console.log(
    `[Pixel Agents] Assets loaded: ${charCount} characters, ${petCount} pets, ${furnitureCount} furniture items`,
  );

  // ── Store + adapter (shared settings + standalone-scoped agents/seats) ──
  const store = new AgentStateStore();
  const adapter = new FileStateAdapter({ namespace: 'standalone' });
  store.setAdapter(adapter);

  // ── Create server ──
  const server = new PixelAgentsServer();

  try {
    // Create runtime first (before server.start, so we can pass it in)
    const runtime = new AgentRuntime(store, claudeProvider);

    // Wire hook events: HTTP POST -> runtime -> hookEventHandler -> agents
    server.onHookEvent((providerId, event) => {
      runtime.handleHookEvent(providerId, event);
    });

    // Assigned once the plan tracker exists below; the WS handler calls through it.
    let refreshPlanUsage: () => Promise<void> = async () => {};

    // onSetHooksEnabled side effect: install/uninstall hooks when user toggles in UI.
    // Captures config from the outer scope after server.start().
    let currentConfig: { port: number; token: string } | null = null;
    const onSetHooksEnabled = async (enabled: boolean): Promise<void> => {
      if (!currentConfig) return;
      if (enabled) {
        await claudeProvider.installHooks(
          `http://127.0.0.1:${currentConfig.port}`,
          currentConfig.token,
        );
        // copyHookScript expects the package root (it appends dist/hooks itself)
        copyHookScript(path.resolve(distRoot, '..'));
        console.log('[Pixel Agents] Hooks installed (user toggle)');
      } else {
        await claudeProvider.uninstallHooks();
        console.log('[Pixel Agents] Hooks uninstalled (user toggle)');
      }
    };

    const config = await server.start({
      store,
      runtime,
      embedded: false,
      host: args.host,
      port: args.port,
      staticDir,
      assetCache,
      onSetHooksEnabled,
      onRefreshPlanUsage: () => refreshPlanUsage(),
    });
    currentConfig = { port: config.port, token: config.token };

    // Sync runtime refs with persisted settings BEFORE first scan tick
    runtime.hooksEnabled.current = adapter.getSetting('pixel-agents.hooksEnabled', true);
    runtime.watchAllSessions.current = adapter.getSetting('pixel-agents.watchAllSessions', false);

    // Install hooks on startup if the persisted setting says so
    if (runtime.hooksEnabled.current) {
      try {
        await claudeProvider.installHooks(`http://127.0.0.1:${config.port}`, config.token);
        // copyHookScript expects the package root (it appends dist/hooks itself)
        copyHookScript(path.resolve(distRoot, '..'));
        console.log('[Pixel Agents] Hooks installed');
      } catch (err) {
        console.error('[Pixel Agents] Failed to install hooks:', err);
      }
    }

    // Start scanning for external sessions (Claude running in user's terminal)
    const cwd = process.cwd();
    const dirs = claudeProvider.getSessionDirs?.(cwd);
    if (dirs && dirs[0]) {
      const projectDir = dirs[0];
      console.log(`[Pixel Agents] Scanning project dir: ${projectDir}`);
      runtime.startProjectScan(projectDir);
      runtime.startExternalScanning(projectDir);
      runtime.startStaleCheck();
    }

    // Everyone on the roster clocks back in (conversations start fresh).
    // Fire-and-forget, but never unhandled: rehireSavedEmployees already guards
    // each roster entry, and this .catch is the last line of defense so a
    // rejection here can never take the whole server process down.
    void rehireSavedEmployees(store, getConfiguredModel(), runtime).catch((err) => {
      console.error('[Pixel Agents] rehireSavedEmployees failed:', err);
    });

    // ── Plan usage gauges: scan transcripts + broadcast every minute ──
    // A plan limit is a subscription's idea. An office running on an API key is
    // billed per token instead, so there is no percentage to show and no local
    // login for `/usage` to interrogate — the gauges stay off and each employee
    // reports what they cost instead.
    const planGaugesApply = readOfficeProvider().mode !== 'apiKey';
    const planTracker = new PlanUsageTracker();
    const tickPlanUsage = async (): Promise<void> => {
      try {
        const msg = await planTracker.tick();
        store.broadcast(msg as unknown as Record<string, unknown>);
      } catch (err) {
        console.error('[Pixel Agents] plan usage tick failed:', err);
      }
    };

    // Re-anchor the gauges on the real percentages from `/usage` (zero tokens).
    refreshPlanUsage = async (): Promise<void> => {
      if (!planGaugesApply) return;
      if (await refreshPlanSnapshot()) planTracker.reloadSnapshot();
      await tickPlanUsage();
    };

    // The probe is a local command (~5s, zero tokens), and the local weighted-token
    // estimate drifts fast on big-context work — measured ~4x too steep. So re-anchor
    // on the real percentages often and let the estimate only fill the gap between.
    let planUsageInterval: NodeJS.Timeout | undefined;
    let planCalibrateInterval: NodeJS.Timeout | undefined;
    if (planGaugesApply) {
      void refreshPlanUsage();
      planUsageInterval = setInterval(() => void tickPlanUsage(), 60_000);
      planCalibrateInterval = setInterval(() => void refreshPlanUsage(), 2 * 60_000);
    } else {
      console.log('[Pixel Agents] Office runs on an API key: plan gauges off, cost shown instead');
    }

    console.log(`\n  Pixel Agents server running at http://${args.host}:${config.port}\n`);

    // ── Remote access token (for headless/container mode) ──
    // When PIXEL_AGENTS_TOKEN env is set, use it; otherwise a random token is generated.
    const isContainerMode = args.host !== '127.0.0.1';
    if (isContainerMode || process.env.PIXEL_AGENTS_TOKEN) {
      console.log(`  Auth token for remote access: ${config.token}\n`);
    }

    // ── Graceful shutdown ──
    async function shutdown(): Promise<void> {
      console.log('\nShutting down...');
      clearInterval(planUsageInterval);
      clearInterval(planCalibrateInterval);
      disposeShellRunner();
      disposeEmployees();
      runtime.dispose();
      // Await the server close so WS clients get a clean close frame — but never
      // hang on it: a stuck close still exits within the fallback window.
      const forceExit = setTimeout(() => process.exit(0), 3000);
      forceExit.unref();
      try {
        await server.stop();
      } catch (err) {
        console.error('[Pixel Agents] error during shutdown:', err);
      }
      clearTimeout(forceExit);
      process.exit(0);
    }

    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
