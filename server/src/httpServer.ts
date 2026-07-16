import fastifyCors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import * as crypto from 'crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Fastify from 'fastify';

import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import type { AssetCache, SetHooksEnabledSideEffect } from './clientMessageHandler.js';
import { handleClientMessage } from './clientMessageHandler.js';
import { HOOK_API_PREFIX, MAX_HOOK_BODY_SIZE } from './constants.js';
import { listDirectory } from './dirLister.js';
import { scaffoldTeamProject } from './teamScaffold.js';
import type { AgentState } from './types.js';

/** Options for creating the HTTP + WebSocket server. */
export interface HttpServerOptions {
  /** true = VS Code embedded mode (ephemeral port, no static, quiet logging) */
  embedded: boolean;
  /** Host to bind to. Default: '127.0.0.1' */
  host?: string;
  /** Port to listen on. Default: 0 (auto-assign) */
  port?: number;
  /** Bearer auth token for hook and WebSocket endpoints */
  token: string;
  /** AgentStateStore for WebSocket broadcast piping */
  store: AgentStateStore;
  /** Shared agent lifecycle core (for toggle side effects + standalone restore). Optional in embedded mode. */
  runtime?: AgentRuntime;
  /** Path to SPA dist directory for static serving (standalone only) */
  staticDir?: string;
  /** Cached assets loaded at startup (standalone only) */
  assetCache?: AssetCache;
  /** Callback when a hook event is received */
  onHookEvent?: (providerId: string, event: Record<string, unknown>) => void;
  /** Invoked when setHooksEnabled is toggled via WebSocket. Standalone installs/uninstalls hooks here. */
  onSetHooksEnabled?: SetHooksEnabledSideEffect;
  /** Invoked when the client asks to re-calibrate the plan gauges from /usage. */
  onRefreshPlanUsage?: () => Promise<void> | void;
}

/** Result of createHttpServer(). */
export interface HttpServerHandle {
  app: FastifyInstance;
  port: number;
}

const startTime = Date.now();

/**
 * Create a Fastify server with hook endpoint, health check, and WebSocket support.
 *
 * All Fastify-specific code lives in this file. The rest of the server layer is
 * framework-agnostic. If Fastify is ever replaced, only this file changes.
 */
export async function createHttpServer(options: HttpServerOptions): Promise<HttpServerHandle> {
  const app = Fastify({
    logger: !options.embedded,
    bodyLimit: MAX_HOOK_BODY_SIZE,
  });

  await app.register(fastifyCors, {
    origin: (origin, cb) => {
      cb(null, isAllowedWsOrigin(origin));
    },
  });
  await app.register(fastifyWebsocket);

  // Static SPA serving (standalone mode only)
  if (!options.embedded && options.staticDir) {
    await app.register(fastifyStatic, {
      root: options.staticDir,
      prefix: '/',
    });
    // HTML5 history fallback: serve index.html for unmatched routes
    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile('index.html');
    });
  }

  // ── Routes ──────────────────────────────────────────────────

  registerHealthRoute(app);
  registerListDirRoute(app);
  registerScaffoldTeamRoute(app);
  registerHookRoute(app, options);
  registerWebSocketRoute(app, options);

  // ── Listen ──────────────────────────────────────────────────

  await app.listen({ host: options.host ?? '127.0.0.1', port: options.port ?? 0 });
  const address = app.server.address();
  const port = typeof address === 'object' ? (address?.port ?? 0) : 0;

  return { app, port };
}

// ── Health ──────────────────────────────────────────────────────

function registerHealthRoute(app: FastifyInstance): void {
  app.get('/api/health', async () => ({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    pid: process.pid,
  }));
}

// ── Folder Picker ──────────────────────────────────────────────

/** Read-only directory listing for the hire form's folder picker. No auth --
 *  same posture as /api/health: it's a local-only, read-only query, and the
 *  CORS origin check registered above already keeps a malicious webpage's JS
 *  from reading the response cross-origin. GET (not a WebSocket message) so
 *  it doesn't need a core/asyncapi.yaml schema entry for what's just a query. */
function registerListDirRoute(app: FastifyInstance): void {
  app.get<{ Querystring: { path?: string } }>(
    '/api/list-dir',
    { preHandler: requireLocalHost },
    async (request) => {
      return listDirectory(request.query.path);
    },
  );
}

/** Creates a new team project folder ("팀 프로젝트 만들기"). Unlike list-dir
 *  this is a write, so it's guarded by requireAllowedOrigin -- unlike the
 *  CORS check registered above (which only stops a cross-origin page's JS
 *  from *reading* the response), this preHandler refuses to run the request
 *  at all when the Origin isn't allowed. No Bearer auth beyond that:
 *  standalone-only, local server, same posture the WebSocket write messages
 *  (hireEmployee, etc.) already rely on. POST because it has a side effect;
 *  a plain object body (not a core/asyncapi.yaml schema) for the same reason
 *  list-dir is a GET and not a WebSocket message.
 *
 *  Content-Type is not checked explicitly here, and doesn't need to be. A
 *  missing Content-Type, or an unregistered one like 'text/xml', is rejected
 *  by Fastify's own body parser with 415 before this handler runs, since only
 *  'application/json' is registered (see FST_ERR_CTP_* in handle-request.js).
 *  'text/plain' is the exception: the default parser accepts it as a raw
 *  string, so it does reach the handler -- but the string carries none of the
 *  required fields and fails the check below with 400. Either way a non-JSON
 *  body scaffolds nothing, and the origin guard blocks a cross-origin request
 *  regardless of Content-Type. Both paths are covered in httpServer.test.ts. */
function registerScaffoldTeamRoute(app: FastifyInstance): void {
  app.post<{ Body: { templateKey?: string; baseDir?: string; projectName?: string } }>(
    '/api/scaffold-team',
    { preHandler: [requireLocalHost, requireAllowedOrigin] },
    async (request, reply) => {
      const { templateKey, baseDir, projectName } = request.body ?? {};
      if (!templateKey || !baseDir || !projectName) {
        reply.code(400);
        return { ok: false, error: '템플릿, 베이스 경로, 프로젝트 이름이 모두 필요합니다.' };
      }
      return scaffoldTeamProject(templateKey, baseDir, projectName);
    },
  );
}

// ── Hook Events ────────────────────────────────────────────────

function registerHookRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.post<{
    Params: { providerId: string };
    Body: Record<string, unknown>;
  }>(
    `${HOOK_API_PREFIX}/:providerId`,
    {
      preHandler: bearerAuth(options.token),
      schema: {
        params: {
          type: 'object',
          properties: {
            providerId: { type: 'string', pattern: '^[a-z0-9-]+$' },
          },
          required: ['providerId'],
        },
      },
    },
    async (request, reply) => {
      const { providerId } = request.params;
      const event = request.body;

      if (event.session_id && event.hook_event_name) {
        options.onHookEvent?.(providerId, event);
      }

      reply.send('ok');
    },
  );
}

// ── Origin Validation (shared by WS handshake + HTTP writes) ────

/** True if a WebSocket handshake (or CORS request, or HTTP write -- see
 *  requireAllowedOrigin below) from this Origin should be let through. A
 *  missing Origin means a non-browser caller — hook scripts, curl, a future
 *  desktop client — since browsers always send one; the attack this guards
 *  against (a malicious webpage's JS opening a request against 127.0.0.1)
 *  necessarily carries an Origin, so letting Origin-less callers through does
 *  not reopen that hole. 127.0.0.1 binding alone does not stop this: the
 *  browser making the connection is local, so bind-address checks never see
 *  a remote peer. Exported for unit testing. */
export function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  // The embedded webview's own scheme — Bearer auth already covers embedded
  // mode, but this is a harmless second layer.
  if (origin.startsWith('vscode-webview://')) return true;
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  // Port is intentionally not compared — the listen port is dynamic in
  // embedded mode, so pinning it here would be both wrong and fragile.
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/** preHandler for HTTP write routes: rejects the request with 403 when its
 *  Origin isn't allowed, reusing isAllowedWsOrigin so the WebSocket handshake
 *  and HTTP writes share a single origin allowlist. Origin-less requests
 *  (hook scripts, curl) pass through, same as isAllowedWsOrigin. Attach to
 *  any write route with `{ preHandler: requireAllowedOrigin }`. */
async function requireAllowedOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAllowedWsOrigin(request.headers.origin)) {
    reply.code(403).send({ ok: false, error: 'forbidden origin' });
  }
}

/** True if the request's Host header names loopback. Unlike the Origin check,
 *  this defends against DNS rebinding: an attacker page at evil.com rebound to
 *  127.0.0.1 fetches itself same-origin (so it may send no Origin at all), but
 *  the browser still sends `Host: evil.com` — the name it believes it dialed —
 *  so a loopback-only Host allowlist rejects it. Safe because the server binds
 *  127.0.0.1: every legitimate caller (our SPA, the Electron window, hook
 *  scripts, curl) reaches it as localhost/127.0.0.1. Revisit if the server ever
 *  binds a non-loopback address (e.g. a future Tailscale mode). Exported for tests. */
export function isAllowedHost(host: string | undefined): boolean {
  if (!host) return false; // HTTP/1.1 always sends Host; its absence is suspicious.
  // Strip the port. IPv6 hosts are bracketed ("[::1]:3100"), so keep the bracket.
  const hostname = host.startsWith('[')
    ? host.slice(0, host.indexOf(']') + 1)
    : (host.split(':')[0] ?? '');
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

/** preHandler for no-auth local routes (the folder picker's list-dir, and as a
 *  second layer on scaffold-team): 403 unless the Host is loopback. Closes the
 *  DNS-rebinding gap the Origin/CORS checks miss on a same-origin request. */
async function requireLocalHost(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAllowedHost(request.headers.host)) {
    reply.code(403).send({ ok: false, error: 'forbidden host' });
  }
}

// ── WebSocket ──────────────────────────────────────────────────

function registerWebSocketRoute(app: FastifyInstance, options: HttpServerOptions): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    // Applies in both standalone and embedded mode. 127.0.0.1 binding does not
    // stop a malicious webpage's own JS from opening this WebSocket — the
    // browser making that connection is itself local (see isAllowedWsOrigin).
    if (!isAllowedWsOrigin(request.headers.origin)) {
      socket.close(4003, 'forbidden origin');
      return;
    }

    // In embedded mode (VS Code), also require Bearer token.
    if (options.embedded) {
      const auth = request.headers.authorization ?? '';
      const expected = `Bearer ${options.token}`;
      const authBuf = Buffer.from(auth);
      const expectedBuf = Buffer.from(expected);
      if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
        socket.close(4001, 'unauthorized');
        return;
      }
    }

    const { store } = options;

    // Pipe store events to WebSocket client
    const onAgentAdded = (id: number, agent: AgentState) => {
      safeSend(socket, {
        type: 'agentCreated',
        id,
        folderName: agent.folderName,
        isExternal: agent.isExternal || undefined,
        isTeammate: agent.leadAgentId !== undefined || undefined,
        teammateName: agent.agentName,
        parentAgentId: agent.leadAgentId,
        teamName: agent.teamName,
        hooksOnly: agent.hooksOnly || undefined,
        palette: agent.palette,
        hueShift: agent.hueShift,
      });
    };

    const onAgentRemoved = (id: number) => {
      safeSend(socket, { type: 'agentClosed', id });
    };

    const onBroadcast = (message: Record<string, unknown>) => {
      safeSend(socket, message);
    };

    store.on('agentAdded', onAgentAdded);
    store.on('agentRemoved', onAgentRemoved);
    store.on('broadcast', onBroadcast);

    // Handle incoming client messages
    socket.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (!options.embedded && msg.type) {
          console.log('[Pixel Agents] WS client message:', msg.type);
        }
        handleClientMessage(msg, (m) => safeSend(socket, m), {
          store,
          runtime: options.runtime,
          cache: options.assetCache ?? null,
          onSetHooksEnabled: options.onSetHooksEnabled,
          onRefreshPlanUsage: options.onRefreshPlanUsage,
        });
      } catch {
        // Malformed JSON, ignore
      }
    });

    socket.on('close', () => {
      store.off('agentAdded', onAgentAdded);
      store.off('agentRemoved', onAgentRemoved);
      store.off('broadcast', onBroadcast);
    });
  });
}

// ── Auth Helper ────────────────────────────────────────────────

function bearerAuth(expectedToken: string) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = request.headers.authorization ?? '';
    const expected = `Bearer ${expectedToken}`;
    const authBuf = Buffer.from(auth);
    const expectedBuf = Buffer.from(expected);
    if (authBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(authBuf, expectedBuf)) {
      reply.code(401).send('unauthorized');
    }
  };
}

// ── Utilities ──────────────────────────────────────────────────

function safeSend(
  socket: { send: (data: string) => void; readyState: number },
  message: Record<string, unknown>,
): void {
  // WebSocket.OPEN = 1
  if (socket.readyState === 1) {
    socket.send(JSON.stringify(message));
  }
}
