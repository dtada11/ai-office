/**
 * Persistent Claude session for the webview chat panel, driven by the Claude
 * Agent SDK. Unlike shellRunner's one-shot `claude -p`, this keeps a single
 * session alive so the conversation carries context across messages.
 *
 * Scope/safety:
 *  - Standalone mode only; the server binds to 127.0.0.1.
 *  - Permission mode stays at the SDK default: every tool call that needs
 *    approval goes through canUseTool, which asks the webview and waits.
 *  - One session at a time; starting a new one replaces the old.
 */

import type { AgentStateStore } from './agentStateStore.js';

type Sdk = typeof import('@anthropic-ai/claude-agent-sdk', {
  with: { 'resolution-mode': 'import' },
});
type Query = ReturnType<Sdk['query']>;
type PermissionResult = Awaited<
  ReturnType<NonNullable<NonNullable<Parameters<Sdk['query']>[0]['options']>['canUseTool']>>
>;
type SDKUserMessage =
  Parameters<Query['streamInput']>[0] extends AsyncIterable<infer M> ? M : never;

/** The SDK is ESM-only and this bundle is CJS; a plain import() would be
 *  downleveled to require() and fail at runtime, so keep it a real import. */
const importSdk = new Function(
  'return import("@anthropic-ai/claude-agent-sdk")',
) as () => Promise<Sdk>;

/** How long a permission request waits for the user before being denied. */
const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

interface Session {
  q: Query;
  cwd: string;
  /** Resolves the generator's pending `next()` with the message the user typed. */
  pushMessage: (text: string) => void;
}

let session: Session | null = null;
const pendingPermissions = new Map<string, (result: PermissionResult) => void>();

function userMessage(text: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  };
}

/** Async iterable the SDK pulls user messages from; `push` feeds it. */
function createInputStream(): {
  stream: AsyncIterable<SDKUserMessage>;
  push: (text: string) => void;
} {
  const queue: SDKUserMessage[] = [];
  let notify: (() => void) | null = null;

  const stream = (async function* () {
    for (;;) {
      if (queue.length === 0) {
        await new Promise<void>((resolve) => {
          notify = resolve;
        });
        notify = null;
      }
      const next = queue.shift();
      if (next) yield next;
    }
  })();

  return {
    stream,
    push: (text: string) => {
      queue.push(userMessage(text));
      notify?.();
    },
  };
}

function broadcastState(store: AgentStateStore): void {
  store.broadcast({
    type: 'agentSessionState',
    running: session !== null,
    cwd: session?.cwd ?? '',
  });
}

/** Forward SDK messages to the webview as chat entries. */
function broadcastMessage(store: AgentStateStore, msg: Record<string, unknown>): void {
  const type = msg.type as string;

  if (type === 'assistant') {
    const message = msg.message as { content?: unknown[] } | undefined;
    for (const block of message?.content ?? []) {
      const b = block as { type: string; text?: string; name?: string };
      if (b.type === 'text' && b.text) {
        store.broadcast({ type: 'agentEvent', kind: 'text', text: b.text });
      } else if (b.type === 'tool_use' && b.name) {
        store.broadcast({ type: 'agentEvent', kind: 'tool', text: b.name });
      }
    }
  } else if (type === 'result') {
    const result = msg as { is_error?: boolean; result?: string };
    store.broadcast({
      type: 'agentEvent',
      kind: 'result',
      text: result.is_error ? `오류: ${result.result ?? '알 수 없음'}` : '',
    });
  }
}

export async function startAgentSession(
  store: AgentStateStore,
  cwd: string,
  model?: string,
): Promise<void> {
  if (session) stopAgentSession(store);
  if (!cwd.trim()) return;

  const input = createInputStream();
  const { query } = await importSdk();

  const q = query({
    prompt: input.stream,
    options: {
      cwd,
      model,
      canUseTool: (toolName, toolInput, options) =>
        new Promise<PermissionResult>((resolve) => {
          const requestId = options.requestId;
          const timer = setTimeout(() => {
            pendingPermissions.delete(requestId);
            resolve({ behavior: 'deny', message: '승인 대기 시간 초과' });
          }, PERMISSION_TIMEOUT_MS);

          pendingPermissions.set(requestId, (result) => {
            clearTimeout(timer);
            resolve(result);
          });

          store.broadcast({
            type: 'agentPermissionRequest',
            requestId,
            toolName,
            title: options.title ?? '',
            input: JSON.stringify(toolInput).slice(0, 500),
          });
        }),
    },
  });

  session = { q, cwd, pushMessage: input.push };
  broadcastState(store);
  console.log(`[Pixel Agents] Agent session started in ${cwd}`);

  void (async () => {
    try {
      for await (const msg of q) {
        broadcastMessage(store, msg as unknown as Record<string, unknown>);
      }
    } catch (err) {
      store.broadcast({
        type: 'agentEvent',
        kind: 'result',
        text: `세션 오류: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      if (session?.q === q) {
        session = null;
        broadcastState(store);
      }
    }
  })();
}

export function sendAgentMessage(store: AgentStateStore, text: string): void {
  if (!session || !text.trim()) return;
  session.pushMessage(text);
  store.broadcast({ type: 'agentEvent', kind: 'user', text });
}

export function resolveAgentPermission(requestId: string, allow: boolean): void {
  const resolve = pendingPermissions.get(requestId);
  if (!resolve) return;
  pendingPermissions.delete(requestId);
  resolve(allow ? { behavior: 'allow' } : { behavior: 'deny', message: '사용자가 거부했습니다.' });
}

/** Switch the model of the running session (no-op when no session). */
export function setAgentSessionModel(model: string): void {
  void session?.q.setModel(model);
}

export function stopAgentSession(store: AgentStateStore): void {
  if (!session) return;
  session.q.close();
  session = null;
  for (const [, resolve] of pendingPermissions) {
    resolve({ behavior: 'deny', message: '세션이 종료되었습니다.' });
  }
  pendingPermissions.clear();
  broadcastState(store);
}

/** Terminate on server shutdown. */
export function disposeAgentSession(): void {
  session?.q.close();
  session = null;
  pendingPermissions.clear();
}
