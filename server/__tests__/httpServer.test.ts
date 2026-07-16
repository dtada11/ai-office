import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AgentStateStore } from '../src/agentStateStore.js';
import { HOOK_API_PREFIX } from '../src/constants.js';
import type { HttpServerHandle } from '../src/httpServer.js';
import { createHttpServer, isAllowedHost, isAllowedWsOrigin } from '../src/httpServer.js';

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

describe('isAllowedHost (DNS-rebinding guard)', () => {
  it('allows loopback hosts with any port', () => {
    expect(isAllowedHost('127.0.0.1:3100')).toBe(true);
    expect(isAllowedHost('localhost:5173')).toBe(true);
    expect(isAllowedHost('[::1]:3100')).toBe(true);
    expect(isAllowedHost('localhost')).toBe(true);
  });

  it('rejects a rebound attacker host', () => {
    expect(isAllowedHost('evil.com:3100')).toBe(false);
  });

  it('rejects a lookalike hostname (subdomain trick)', () => {
    expect(isAllowedHost('127.0.0.1.evil.com:3100')).toBe(false);
  });

  it('rejects a missing Host header', () => {
    // HTTP/1.1 always sends Host; its absence is treated as suspicious.
    expect(isAllowedHost(undefined)).toBe(false);
  });
});

describe('GET /api/list-dir host guard', () => {
  let handle: HttpServerHandle;

  beforeEach(async () => {
    handle = await createHttpServer({ embedded: true, token: 't', store: new AgentStateStore() });
  });
  afterEach(async () => {
    await handle.app.close();
  });

  it('serves a loopback Host', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/list-dir',
      headers: { host: '127.0.0.1:3100' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a rebound (non-loopback) Host with 403', async () => {
    const res = await handle.app.inject({
      method: 'GET',
      url: '/api/list-dir',
      headers: { host: 'evil.com' },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('POST /api/scaffold-team origin guard', () => {
  let handle: HttpServerHandle;
  let tmpRoot: string;
  const token = 'test-token';

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pxl-http-origin-test-'));
    handle = await createHttpServer({
      embedded: true,
      token,
      store: new AgentStateStore(),
    });
  });

  afterEach(async () => {
    await handle.app.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // 1. Allowed Origin + a normal JSON body -> passes through, folder created.
  it('allows an allowed Origin with a normal JSON body', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/scaffold-team',
      headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
      payload: { templateKey: 'pure-dev', baseDir: tmpRoot, projectName: 'ok-project' },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmpRoot, 'ok-project'))).toBe(true);
  });

  // 2. Disallowed Origin (the evil.com scenario) -> 403, nothing created.
  it('rejects a disallowed Origin with 403 and creates nothing', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/scaffold-team',
      headers: { origin: 'http://evil.com', 'content-type': 'application/json' },
      payload: { templateKey: 'pure-dev', baseDir: tmpRoot, projectName: 'evil-project' },
    });
    expect(res.statusCode).toBe(403);
    expect(fs.existsSync(path.join(tmpRoot, 'evil-project'))).toBe(false);
  });

  // 3. No Origin header at all -> passes through. This is the non-browser
  // caller case (hook scripts, curl, a future desktop client) the rule must
  // never break.
  it('allows a missing Origin (non-browser callers) with a normal JSON body', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/scaffold-team',
      headers: { 'content-type': 'application/json' },
      payload: { templateKey: 'pure-dev', baseDir: tmpRoot, projectName: 'no-origin-project' },
    });
    expect(res.statusCode).toBe(200);
    expect(fs.existsSync(path.join(tmpRoot, 'no-origin-project'))).toBe(true);
  });

  // 4. An unrecognized Content-Type is rejected before the route handler
  // runs at all -- this is Fastify's own body parser (only 'application/json'
  // is registered), not code added by this route. Asserted here so that
  // behavior stays intentional and covered, not just assumed.
  it('rejects an unsupported Content-Type with 415, before reaching the handler', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/scaffold-team',
      headers: { origin: 'http://localhost:5173', 'content-type': 'text/xml' },
      payload: '<xml/>',
    });
    expect(res.statusCode).toBe(415);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  // 4b. 'text/plain' is the one non-JSON Content-Type Fastify's default parser
  // still accepts, so it slips past the 415 above and reaches the handler as a
  // raw string. That string has none of the required fields, so the field check
  // returns 400 -- nothing is scaffolded either way. Locks the comment on
  // registerScaffoldTeamRoute (the causal path text/plain actually takes).
  it('rejects a text/plain body with 400: parser accepts it, field check fails', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: '/api/scaffold-team',
      headers: { origin: 'http://localhost:5173', 'content-type': 'text/plain' },
      payload: 'templateKey=pure-dev',
    });
    expect(res.statusCode).toBe(400);
    expect(fs.readdirSync(tmpRoot)).toEqual([]);
  });

  // 5. The hook endpoint (Origin-less by nature -- Claude Code's hook script
  // is not a browser) is untouched by this route's origin guard: it only
  // checks Bearer auth, same as before.
  it('does not break the Origin-less hook endpoint', async () => {
    const res = await handle.app.inject({
      method: 'POST',
      url: `${HOOK_API_PREFIX}/claude`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { session_id: 'abc', hook_event_name: 'Notification' },
    });
    expect(res.statusCode).toBe(200);
  });
});
