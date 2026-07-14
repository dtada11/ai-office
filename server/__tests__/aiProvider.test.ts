import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Isolate ~/.pixel-agents/ai-provider.json reads from the real home directory.
let tmpBase: string;

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => tmpBase };
});

// Must import AFTER the os mock is set up.
const { buildEnv, normalizeProvider, readOfficeProvider } = await import('../src/aiProvider.js');

describe('aiProvider', () => {
  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-aiprovider-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  describe('normalizeProvider', () => {
    it('drops a legacy oauthToken record to undefined (follow the office default)', () => {
      expect(normalizeProvider({ mode: 'oauthToken', oauthToken: 'x' })).toBeUndefined();
    });

    it('keeps a valid apiKey record', () => {
      expect(normalizeProvider({ mode: 'apiKey', apiKey: 'k' })).toEqual({
        mode: 'apiKey',
        apiKey: 'k',
      });
    });
  });

  describe('buildEnv', () => {
    const savedKeys: Record<string, string | undefined> = {};
    const KEYS = ['ANTHROPIC_API_KEY', 'CLAUDE_CODE_OAUTH_TOKEN', 'Anthropic_Api_Key'];

    beforeEach(() => {
      for (const key of KEYS) savedKeys[key] = process.env[key];
    });

    afterEach(() => {
      for (const key of KEYS) {
        if (savedKeys[key] === undefined) delete process.env[key];
        else process.env[key] = savedKeys[key];
      }
    });

    it('subscription mode strips ANTHROPIC_API_KEY and CLAUDE_CODE_OAUTH_TOKEN, case-insensitively', () => {
      process.env.ANTHROPIC_API_KEY = 'leaked-key';
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'leaked-token';
      // Windows env keys are case-insensitive; a stray casing variant must also go.
      process.env.Anthropic_Api_Key = 'leaked-key-2';

      const env = buildEnv({ mode: 'subscription' });

      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
      expect(env.Anthropic_Api_Key).toBeUndefined();
    });

    it('apiKey mode sets only ANTHROPIC_API_KEY, never the OAuth var', () => {
      const env = buildEnv({ mode: 'apiKey', apiKey: 'k' });

      expect(env.ANTHROPIC_API_KEY).toBe('k');
      expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    });
  });

  describe('readOfficeProvider', () => {
    it('normalizes a legacy oauthToken file to subscription', () => {
      const dir = path.join(tmpBase, '.pixel-agents');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'ai-provider.json'),
        JSON.stringify({ mode: 'oauthToken', oauthToken: 'x' }),
      );

      expect(readOfficeProvider().mode).toBe('subscription');
    });
  });
});
