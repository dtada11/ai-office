import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate settings/layout/provider files from the real ~/.pixel-agents/ —
// same pattern as claudeHookInstaller.test.ts.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

vi.mock('../src/claudeSettings.js', () => ({
  getConfiguredModel: vi.fn(() => undefined),
}));

vi.mock('../src/employees.js', () => ({
  hireEmployee: vi.fn(),
  clockIn: vi.fn(async () => undefined),
  clockOut: vi.fn(),
  fireEmployee: vi.fn(),
  getPendingPermissionRequests: vi.fn(() => []),
  isEmployee: vi.fn(() => false),
  renameEmployee: vi.fn(),
  resolveEmployeePermission: vi.fn(),
  sendStaffTo: vi.fn(),
  sendToEmployee: vi.fn(),
  setEmployeeModelFor: vi.fn(),
  setEmployeePersona: vi.fn(),
  setEmployeeSeat: vi.fn(),
}));

const { AgentStateStore } = await import('../src/agentStateStore.js');
const { handleClientMessage } = await import('../src/clientMessageHandler.js');
const { FileStateAdapter } = await import('../src/fileStateAdapter.js');
const { hireEmployee, clockIn } = await import('../src/employees.js');

function context() {
  const store = new AgentStateStore();
  store.setAdapter(new FileStateAdapter({ namespace: 'standalone' }));
  return { store, cache: null };
}

describe('onboarding: clientMessageHandler', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-onboarding-test-'));
    vi.clearAllMocks();
    delete process.env.PIXEL_AGENTS_VERSION;
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpBase, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    delete process.env.PIXEL_AGENTS_VERSION;
  });

  it('setOnboardingDone → adapter에 저장된다', () => {
    const ctx = context();
    handleClientMessage({ type: 'setOnboardingDone', done: true }, vi.fn(), ctx);
    expect(ctx.store.getAdapter()?.getSetting('pixel-agents.onboardingDone', false)).toBe(true);
  });

  it('setOnboardingDone false → "다시 보기" 재오픈용으로 저장된다', () => {
    const ctx = context();
    handleClientMessage({ type: 'setOnboardingDone', done: true }, vi.fn(), ctx);
    handleClientMessage({ type: 'setOnboardingDone', done: false }, vi.fn(), ctx);
    expect(ctx.store.getAdapter()?.getSetting('pixel-agents.onboardingDone', true)).toBe(false);
  });

  it('webviewReady → settingsLoaded에 onboardingDone이 포함된다 (기본 false)', () => {
    const ctx = context();
    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (msg) => sent.push(msg), ctx);

    const settingsLoaded = sent.find((m) => m.type === 'settingsLoaded');
    expect(settingsLoaded).toBeDefined();
    expect(settingsLoaded?.onboardingDone).toBe(false);
  });

  it('신규 사용자(onboardingDone=false, lastSeenVersion 미설정)면 lastSeenVersion이 현재 버전으로 채워지고 저장된다', () => {
    process.env.PIXEL_AGENTS_VERSION = '1.2.3';
    const ctx = context();
    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (msg) => sent.push(msg), ctx);

    const settingsLoaded = sent.find((m) => m.type === 'settingsLoaded');
    expect(settingsLoaded?.lastSeenVersion).toBe('1.2.3');
    expect(ctx.store.getAdapter()?.getSetting('pixel-agents.lastSeenVersion', '')).toBe('1.2.3');
  });

  it('온보딩을 마친 사용자는 lastSeenVersion이 빈 문자열이어도 그대로 둔다 (버전 인디케이터 정상 동작 보존)', () => {
    process.env.PIXEL_AGENTS_VERSION = '1.2.3';
    const ctx = context();
    ctx.store.getAdapter()?.setSetting('pixel-agents.onboardingDone', true);

    const sent: Record<string, unknown>[] = [];
    handleClientMessage({ type: 'webviewReady' }, (msg) => sent.push(msg), ctx);

    const settingsLoaded = sent.find((m) => m.type === 'settingsLoaded');
    expect(settingsLoaded?.lastSeenVersion).toBe('');
  });

  it('hireEmployee 실패 시 officeNotice가 broadcast된다', async () => {
    vi.mocked(hireEmployee).mockRejectedValue(new Error('키가 유효하지 않습니다'));
    const ctx = context();
    const broadcasts: Record<string, unknown>[] = [];
    ctx.store.on('broadcast', (msg) => broadcasts.push(msg));

    handleClientMessage(
      { type: 'hireEmployee', name: '코더', cwd: '/work', role: 'staff' },
      vi.fn(),
      ctx,
    );
    // hireEmployee's rejection is handled in a .catch() microtask.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const notice = broadcasts.find((m) => m.type === 'officeNotice');
    expect(notice).toBeDefined();
    expect(notice?.level).toBe('error');
    expect(String(notice?.text)).toContain('키가 유효하지 않습니다');
  });

  it('clockIn 실패 시 officeNotice가 broadcast된다', async () => {
    vi.mocked(clockIn).mockRejectedValue(new Error('세션을 시작할 수 없습니다'));
    const ctx = context();
    const broadcasts: Record<string, unknown>[] = [];
    ctx.store.on('broadcast', (msg) => broadcasts.push(msg));

    handleClientMessage({ type: 'clockIn', agentId: 1 }, vi.fn(), ctx);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const notice = broadcasts.find((m) => m.type === 'officeNotice');
    expect(notice).toBeDefined();
    expect(notice?.level).toBe('error');
    expect(String(notice?.text)).toContain('세션을 시작할 수 없습니다');
  });
});
