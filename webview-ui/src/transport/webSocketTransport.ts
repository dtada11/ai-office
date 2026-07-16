import type { ClientMessage, ServerMessage } from '../../../core/src/messages.js';
import type { MessageTransport } from './types.js';

/** Cap on messages queued while disconnected. Without a bound, a long outage
 *  during which the user keeps interacting queues messages forever; on
 *  reconnect they'd all replay at once, including now-stale commands (e.g.
 *  for a session that no longer exists). Keep only the most recent N. */
const MAX_PENDING_MESSAGES = 50;

/**
 * WebSocket transport for standalone browser mode.
 * Connects to the Pixel Agents server via WebSocket for bidirectional messaging.
 * Includes automatic reconnection with exponential backoff and message queuing.
 */
export class WebSocketTransport implements MessageTransport {
  private ws: WebSocket | null = null;
  private handlers: Array<(msg: ServerMessage) => void> = [];
  private reconnectHandlers: Array<() => void> = [];
  private url: string;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private pendingMessages: ClientMessage[] = [];
  /** False until the first successful connect — distinguishes the initial
   *  connect (no one needs telling) from a reconnect (webviewReady must be resent). */
  private hasConnectedBefore = false;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.disposed) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      console.log('[Transport] WebSocket connected');
      // Flush any messages queued while connecting
      for (const msg of this.pendingMessages) {
        this.ws!.send(JSON.stringify(msg));
      }
      this.pendingMessages = [];
      if (this.hasConnectedBefore) {
        for (const handler of this.reconnectHandlers) handler();
      }
      this.hasConnectedBefore = true;
    };

    this.ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data as string) as ServerMessage;
        for (const handler of this.handlers) handler(msg);
      } catch {
        // Malformed JSON, ignore
      }
    };

    this.ws.onclose = () => {
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, triggering reconnect
    };
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue messages while connecting (flushed in onopen). Bounded so a
      // long disconnect doesn't grow this without limit — drop the oldest
      // queued message once at capacity.
      this.pendingMessages.push(message);
      if (this.pendingMessages.length > MAX_PENDING_MESSAGES) {
        this.pendingMessages.shift();
      }
    }
  }

  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  onReconnect(handler: () => void): () => void {
    this.reconnectHandlers.push(handler);
    return () => {
      this.reconnectHandlers = this.reconnectHandlers.filter((h) => h !== handler);
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.handlers = [];
    this.reconnectHandlers = [];
    this.pendingMessages = [];
  }

  private scheduleReconnect(): void {
    // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000);
    this.reconnectAttempts++;
    console.log(
      `[Transport] WebSocket reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}
