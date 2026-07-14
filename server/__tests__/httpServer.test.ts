import { describe, expect, it } from 'vitest';

import { isAllowedWsOrigin } from '../src/httpServer.js';

describe('isAllowedWsOrigin', () => {
  it('allows a missing Origin (non-browser callers: hooks, curl, native clients)', () => {
    expect(isAllowedWsOrigin(undefined)).toBe(true);
  });

  it('allows 127.0.0.1, any port', () => {
    expect(isAllowedWsOrigin('http://127.0.0.1:3100')).toBe(true);
  });

  it('allows localhost, any port', () => {
    expect(isAllowedWsOrigin('http://localhost:5173')).toBe(true);
  });

  it('allows the IPv6 loopback', () => {
    expect(isAllowedWsOrigin('http://[::1]:3100')).toBe(true);
  });

  it('allows the VS Code webview scheme', () => {
    expect(isAllowedWsOrigin('vscode-webview://abc123')).toBe(true);
  });

  it('rejects an unrelated origin', () => {
    expect(isAllowedWsOrigin('http://evil.com')).toBe(false);
  });

  it('rejects a lookalike hostname (subdomain trick)', () => {
    expect(isAllowedWsOrigin('http://127.0.0.1.evil.com')).toBe(false);
  });

  it('rejects a malformed origin', () => {
    expect(isAllowedWsOrigin('not a url')).toBe(false);
  });
});
