/**
 * Detect dangerous Bash metacharacters that enable command chaining/substitution.
 * Must match server/src/toolPermissions.ts:hasDangerousBashMetachars exactly.
 */
const BASH_DANGER_CHARS = [';', '&&', '||', '|', '&', '`', '$(', '>', '>>', '<', '\n'];

export function hasDangerousBashMetachars(command: string | undefined): boolean {
  if (!command) return false;
  return BASH_DANGER_CHARS.some((char) => command.includes(char));
}
