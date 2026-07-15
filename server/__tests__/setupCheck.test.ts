import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/claudeCli.js', () => ({
  runClaudeCli: vi.fn(),
}));

// readOfficeProvider is mocked so apiKey-mode tests control the "stored"
// secret without touching the real ~/.pixel-agents/ai-provider.json file.
// buildEnv is left as the real implementation — the whole point of one test
// below is proving IT strips ANTHROPIC_API_KEY, not a mock of it.
let mockProviderConfig: { mode: 'subscription' | 'apiKey'; apiKey?: string; model?: string } = {
  mode: 'subscription',
};

vi.mock('../src/aiProvider.js', async () => {
  const actual =
    await vi.importActual<typeof import('../src/aiProvider.js')>('../src/aiProvider.js');
  return {
    ...actual,
    readOfficeProvider: () => mockProviderConfig,
  };
});

const { runSetupCheck } = await import('../src/setupCheck.js');
const { runClaudeCli } = await import('../src/claudeCli.js');

describe('runSetupCheck: subscription', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderConfig = { mode: 'subscription' };
  });

  afterEach(() => {
    if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it('--version code0 + /usage code0 → 둘 다 ok', async () => {
    vi.mocked(runClaudeCli)
      .mockResolvedValueOnce({ code: 0, stdout: '1.2.3', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'Current session: 10% used', stderr: '' });

    const checks = await runSetupCheck('subscription');

    expect(checks).toEqual([
      { id: 'claudeInstalled', status: 'ok', detail: '1.2.3' },
      { id: 'claudeLoggedIn', status: 'ok' },
    ]);
  });

  it('--version ENOENT → claudeInstalled fail, claudeLoggedIn skip', async () => {
    vi.mocked(runClaudeCli).mockResolvedValueOnce({
      code: null,
      stdout: '',
      stderr: '',
      spawnError: 'ENOENT',
    });

    const checks = await runSetupCheck('subscription');

    expect(checks).toEqual([
      { id: 'claudeInstalled', status: 'fail', detail: 'ENOENT' },
      { id: 'claudeLoggedIn', status: 'skip' },
    ]);
    // claudeLoggedIn must not even attempt a second spawn once installed fails.
    expect(runClaudeCli).toHaveBeenCalledTimes(1);
  });

  it('/usage code1 + stderr → claudeLoggedIn fail, detail에 마지막 줄', async () => {
    vi.mocked(runClaudeCli)
      .mockResolvedValueOnce({ code: 0, stdout: '1.2.3', stderr: '' })
      .mockResolvedValueOnce({
        code: 1,
        stdout: '',
        stderr: 'some warning\nError: not logged in',
      });

    const checks = await runSetupCheck('subscription');

    expect(checks[1]).toEqual({
      id: 'claudeLoggedIn',
      status: 'fail',
      detail: 'Error: not logged in',
    });
  });

  it('buildEnv 적용돼 subscription 검사 env에서 ANTHROPIC_API_KEY가 제거된다', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant-should-be-stripped';
    vi.mocked(runClaudeCli)
      .mockResolvedValueOnce({ code: 0, stdout: '1.2.3', stderr: '' })
      .mockResolvedValueOnce({ code: 0, stdout: 'ok', stderr: '' });

    await runSetupCheck('subscription');

    const firstCallEnv = vi.mocked(runClaudeCli).mock.calls[0][1].env;
    expect(firstCallEnv).toBeDefined();
    expect(firstCallEnv?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});

describe('runSetupCheck: apiKey', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('키 미설정 → apiKeyFormat fail, apiKeyValid skip', async () => {
    mockProviderConfig = { mode: 'apiKey' };

    const checks = await runSetupCheck('apiKey');

    expect(checks).toEqual([
      { id: 'apiKeyFormat', status: 'fail' },
      { id: 'apiKeyValid', status: 'skip' },
    ]);
    expect(runClaudeCli).not.toHaveBeenCalled();
  });

  it('형식이 맞고 fetch 200 → apiKeyValid ok', async () => {
    mockProviderConfig = { mode: 'apiKey', apiKey: 'sk-ant-abc123' };
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ data: [{ id: 'claude-fable-5' }] }),
    }) as unknown as typeof fetch;

    const checks = await runSetupCheck('apiKey');

    expect(checks[0]).toEqual({ id: 'apiKeyFormat', status: 'ok' });
    expect(checks[1]).toEqual({ id: 'apiKeyValid', status: 'ok', detail: 'claude-fable-5' });
  });

  it('fetch 401 → apiKeyValid fail', async () => {
    mockProviderConfig = { mode: 'apiKey', apiKey: 'sk-ant-abc123' };
    global.fetch = vi.fn().mockResolvedValue({ status: 401 }) as unknown as typeof fetch;

    const checks = await runSetupCheck('apiKey');

    expect(checks[1].status).toBe('fail');
  });

  it('fetch가 throw → apiKeyValid fail', async () => {
    mockProviderConfig = { mode: 'apiKey', apiKey: 'sk-ant-abc123' };
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const checks = await runSetupCheck('apiKey');

    expect(checks[1]).toEqual({ id: 'apiKeyValid', status: 'fail', detail: 'network down' });
  });
});
