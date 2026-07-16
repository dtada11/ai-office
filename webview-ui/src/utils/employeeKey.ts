/**
 * Compute the same employeeKey as server/src/toolPermissions.ts:employeeKey(name).
 * Must match exactly — used to identify an employee's allowlist across server/webview.
 *
 * Web Crypto API version of server's crypto.createHash('sha256').
 */
export async function computeEmployeeKey(name: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(name);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);

  // Convert to hex string, take first 8 chars
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  const hashSlice = hashHex.slice(0, 8);

  // Safe name: keep only letters, numbers, underscore, hyphen
  const safe = name
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return safe ? `${safe}-${hashSlice}` : hashSlice;
}
