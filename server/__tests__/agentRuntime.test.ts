import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersistedAgent } from '../../core/src/schemas.js';
import { AgentRuntime } from '../src/agentRuntime.js';
import { AgentStateStore, newAgentState } from '../src/agentStateStore.js';
import { claudeProvider } from '../src/providers/hook/claude/claude.js';
import type { AgentState } from '../src/types.js';

/**
 * AgentRuntime is the shared lifecycle core both surfaces compose, and it sat at
 * 0% coverage — see the vault note 57_지표_커버리지_죽은코드_20260720. These tests
 * cover the logic AgentRuntime actually owns (removal, teammate selection,
 * scanner idempotency, restore filtering, disposal) rather than the parts that
 * only forward into fileWatcher/hookEventHandler, which have their own suites.
 *
 * Uses the real claudeProvider like hookEventHandler.test.ts does — the provider
 * is inert here, and a fake would only test the fake.
 *
 * NOTE: the constructor wires module-level singletons in fileWatcher and
 * transcriptParser (setDismissalTracker, setHookProvider, ...). Each test builds
 * a fresh runtime, so the last one built wins for the duration of that test.
 * Don't hold two runtimes at once and expect them to be independent.
 */

let tmpDir: string;

function makeStore(): AgentStateStore {
  return new AgentStateStore();
}

function makeRuntime(store: AgentStateStore): AgentRuntime {
  return new AgentRuntime(store, claudeProvider);
}

function addAgent(store: AgentStateStore, id: number, overrides: Partial<AgentState> = {}): void {
  const agent = newAgentState({
    id,
    sessionId: `sess-${id.toString()}`,
    terminalRef: undefined,
    isExternal: true,
    projectDir: '/test',
    jsonlFile: path.join(tmpDir, `session-${id.toString()}.jsonl`),
    ...overrides,
  });
  store.set(id, agent);
}

/** Minimal StateAdapter — only loadAgents matters for restoreExternalAgents. */
function makeAdapter(persisted: PersistedAgent[]) {
  return {
    loadAgents: () => persisted,
    saveAgents: vi.fn(),
    loadSeats: () => ({}),
    saveSeats: vi.fn(),
    getSetting: <T>(_key: string, defaultValue: T): T => defaultValue,
    setSetting: vi.fn(),
  };
}

function persistedAgent(overrides: Partial<PersistedAgent> = {}): PersistedAgent {
  return {
    id: 1,
    terminalName: 'term',
    isExternal: true,
    jsonlFile: path.join(tmpDir, 'restored.jsonl'),
    projectDir: '/test',
    ...overrides,
  };
}

describe('AgentRuntime', () => {
  let store: AgentStateStore;
  let runtime: AgentRuntime;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-runtime-test-'));
    store = makeStore();
    runtime = makeRuntime(store);
  });

  afterEach(() => {
    runtime.dispose();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  describe('removeAgent', () => {
    it('clears the per-agent timers and watcher entries it owns', () => {
      addAgent(store, 1);
      runtime.pollingTimers.set(
        1,
        setInterval(() => undefined, 60_000),
      );
      runtime.jsonlPollTimers.set(
        1,
        setInterval(() => undefined, 60_000),
      );
      runtime.waitingTimers.set(
        1,
        setTimeout(() => undefined, 60_000),
      );
      runtime.permissionTimers.set(
        1,
        setTimeout(() => undefined, 60_000),
      );

      runtime.removeAgent(1);

      expect(store.has(1)).toBe(false);
      expect(runtime.pollingTimers.has(1)).toBe(false);
      expect(runtime.jsonlPollTimers.has(1)).toBe(false);
      expect(runtime.waitingTimers.has(1)).toBe(false);
      expect(runtime.permissionTimers.has(1)).toBe(false);
      expect(runtime.fileWatchers.has(1)).toBe(false);
    });

    // The source comments this ordering ("Notify adapter before deleting from
    // store") because the adapter needs the agent's fields — jsonlFile above
    // all — to dismiss the file. Delete first and the callback gets nothing.
    it('passes the agent to onAgentRemoved before deleting it from the store', () => {
      addAgent(store, 1, { jsonlFile: '/test/before-delete.jsonl' });
      let seenJsonl: string | undefined;
      let stillInStore: boolean | undefined;
      runtime.setLifecycleCallbacks({
        onAgentRemoved: (id, agent) => {
          seenJsonl = agent.jsonlFile;
          stillInStore = store.has(id);
        },
      });

      runtime.removeAgent(1);

      expect(seenJsonl).toBe('/test/before-delete.jsonl');
      expect(stillInStore).toBe(true);
    });

    it('is a no-op for an unknown id', () => {
      const onAgentRemoved = vi.fn();
      runtime.setLifecycleCallbacks({ onAgentRemoved });

      expect(() => {
        runtime.removeAgent(999);
      }).not.toThrow();
      expect(onAgentRemoved).not.toHaveBeenCalled();
    });
  });

  describe('removeTeammates', () => {
    it('removes only agents whose leadAgentId matches, leaving the lead and others', () => {
      addAgent(store, 1, { isTeamLead: true });
      addAgent(store, 2, { leadAgentId: 1 });
      addAgent(store, 3, { leadAgentId: 1 });
      addAgent(store, 4, { leadAgentId: 99 }); // another lead's teammate
      addAgent(store, 5); // unrelated solo agent

      runtime.removeTeammates(1);

      expect(store.has(1)).toBe(true);
      expect(store.has(2)).toBe(false);
      expect(store.has(3)).toBe(false);
      expect(store.has(4)).toBe(true);
      expect(store.has(5)).toBe(true);
    });

    it('does nothing when the lead has no teammates', () => {
      addAgent(store, 1, { isTeamLead: true });

      runtime.removeTeammates(1);

      expect(store.has(1)).toBe(true);
    });
  });

  describe('removeTeammate', () => {
    it('reports the removal source to the adapter and removes the agent', () => {
      addAgent(store, 2, { leadAgentId: 1 });
      const onTeammateRemoved = vi.fn();
      runtime.setLifecycleCallbacks({ onTeammateRemoved });

      runtime.removeTeammate(2, 'team-config');

      expect(onTeammateRemoved).toHaveBeenCalledTimes(1);
      expect(onTeammateRemoved.mock.calls[0]?.[0]).toBe(2);
      expect(onTeammateRemoved.mock.calls[0]?.[2]).toBe('team-config');
      expect(store.has(2)).toBe(false);
    });

    it('dismisses the teammate transcript so the scanner does not re-adopt it', () => {
      const jsonlFile = path.join(tmpDir, 'teammate.jsonl');
      addAgent(store, 2, { leadAgentId: 1, jsonlFile });

      runtime.removeTeammate(2, 'hooks');

      expect(runtime.dismissalTracker.isDismissed(jsonlFile)).toBe(true);
    });
  });

  describe('scanner start guards', () => {
    // Both scanners are started from adapter code paths that can fire more than
    // once (re-activation, config change). Without the guard each call would
    // leak another setInterval that nothing holds a handle to.
    it('startExternalScanning is idempotent', () => {
      const spy = vi.spyOn(global, 'setInterval');

      runtime.startExternalScanning(tmpDir);
      const afterFirst = spy.mock.calls.length;
      runtime.startExternalScanning(tmpDir);

      expect(spy.mock.calls.length).toBe(afterFirst);
      spy.mockRestore();
    });

    it('startStaleCheck is idempotent', () => {
      const spy = vi.spyOn(global, 'setInterval');

      runtime.startStaleCheck();
      const afterFirst = spy.mock.calls.length;
      runtime.startStaleCheck();

      expect(spy.mock.calls.length).toBe(afterFirst);
      spy.mockRestore();
    });
  });

  describe('restoreExternalAgents', () => {
    it('does nothing without an adapter', () => {
      expect(() => {
        runtime.restoreExternalAgents();
      }).not.toThrow();
      expect([...store.keys()]).toEqual([]);
    });

    it('restores an external agent whose transcript still exists', () => {
      const jsonlFile = path.join(tmpDir, 'restored.jsonl');
      fs.writeFileSync(jsonlFile, 'line\n');
      store.setAdapter(makeAdapter([persistedAgent({ id: 7, jsonlFile, sessionId: 'sess-7' })]));

      runtime.restoreExternalAgents();

      const agent = store.get(7);
      expect(agent).toBeDefined();
      expect(agent?.isExternal).toBe(true);
      expect(runtime.knownJsonlFiles.has(jsonlFile)).toBe(true);
      // Offset seeded to current size so restore doesn't replay the whole file
      // as if it were new activity.
      expect(agent?.fileOffset).toBe(fs.statSync(jsonlFile).size);
    });

    it('skips non-external agents — they need a terminal the runtime cannot rebind', () => {
      const jsonlFile = path.join(tmpDir, 'terminal.jsonl');
      fs.writeFileSync(jsonlFile, 'line\n');
      store.setAdapter(makeAdapter([persistedAgent({ id: 3, jsonlFile, isExternal: false })]));

      runtime.restoreExternalAgents();

      expect(store.has(3)).toBe(false);
    });

    it('skips agents whose transcript is gone', () => {
      store.setAdapter(
        makeAdapter([persistedAgent({ id: 4, jsonlFile: path.join(tmpDir, 'missing.jsonl') })]),
      );

      runtime.restoreExternalAgents();

      expect(store.has(4)).toBe(false);
    });

    it('falls back to the transcript filename when sessionId was not persisted', () => {
      const jsonlFile = path.join(tmpDir, 'abc-123.jsonl');
      fs.writeFileSync(jsonlFile, '');
      store.setAdapter(makeAdapter([persistedAgent({ id: 5, jsonlFile, sessionId: undefined })]));

      runtime.restoreExternalAgents();

      expect(store.get(5)?.sessionId).toBe('abc-123');
    });

    // Without this the next spawned agent would reuse a restored id and the two
    // would collide in the store.
    it('advances nextAgentId past the highest restored id', () => {
      const jsonlFile = path.join(tmpDir, 'high.jsonl');
      fs.writeFileSync(jsonlFile, '');
      store.nextAgentId.current = 1;
      store.setAdapter(makeAdapter([persistedAgent({ id: 42, jsonlFile })]));

      runtime.restoreExternalAgents();

      expect(store.nextAgentId.current).toBe(43);
    });

    it('does not overwrite an agent already live in the store', () => {
      const jsonlFile = path.join(tmpDir, 'live.jsonl');
      fs.writeFileSync(jsonlFile, '');
      addAgent(store, 9, { folderName: 'live-one' });
      store.setAdapter(makeAdapter([persistedAgent({ id: 9, jsonlFile, folderName: 'stale' })]));

      runtime.restoreExternalAgents();

      expect(store.get(9)?.folderName).toBe('live-one');
      expect(runtime.knownJsonlFiles.has(jsonlFile)).toBe(true);
    });
  });

  describe('dispose', () => {
    it('removes every agent and clears the scan timers', () => {
      addAgent(store, 1);
      addAgent(store, 2);
      runtime.startExternalScanning(tmpDir);
      runtime.startStaleCheck();
      runtime.projectScanTimer.current = setInterval(() => undefined, 60_000);

      runtime.dispose();

      expect([...store.keys()]).toEqual([]);
      expect(runtime.projectScanTimer.current).toBeNull();
    });

    it('is safe to call twice', () => {
      addAgent(store, 1);
      runtime.dispose();

      expect(() => {
        runtime.dispose();
      }).not.toThrow();
    });
  });
});
