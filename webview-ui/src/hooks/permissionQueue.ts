/** Pure queue operations behind each employee's permission requests. Kept apart
 *  from the message-handling effect in useExtensionMessages.ts so the append/
 *  remove rules are decidable — and testable — without a DOM or a mocked
 *  transport.
 *
 *  This is the fix for the parallel-tool-call deadlock: Claude calls tools in
 *  parallel, so several requests can land for the same employee before any is
 *  answered. The old code kept one slot per employee and silently overwrote
 *  it — the overwritten request had no way left to be answered, and the tool
 *  call it belonged to stayed parked on the server forever. A queue never
 *  drops one. */

/** A tool call one employee is waiting on approval for. Defined here (not in
 *  useExtensionMessages.ts, which re-exports it) so this module — and anything
 *  that only needs the queue logic, like its tests — never has to pull in that
 *  file's DOM-dependent code just to see the shape of a request. */
export interface PermissionRequest {
  requestId: string;
  toolName: string;
  title: string;
  input: string;
}

/** Append a new request unless its id is already queued — a dropped-then-
 *  restored connection can re-deliver one still in flight. */
export function enqueuePermission(
  queue: PermissionRequest[],
  request: PermissionRequest,
): PermissionRequest[] {
  if (queue.some((p) => p.requestId === request.requestId)) return queue;
  return [...queue, request];
}

/** Remove one answered request by id; the rest of the queue is untouched.
 *  Returns the same array reference when nothing matched, so callers can
 *  skip a re-render (e.g. a late server resolve for a request the optimistic
 *  local clear already removed). */
export function dequeuePermission(
  queue: PermissionRequest[],
  requestId: string,
): PermissionRequest[] {
  const next = queue.filter((p) => p.requestId !== requestId);
  return next.length === queue.length ? queue : next;
}
