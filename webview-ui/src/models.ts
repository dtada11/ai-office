/** The models an employee can be put on, and how their ids read on screen.
 *  Shared by the office default (TokenGauge) and the per-employee switch
 *  (EmployeeChat), which must offer the same list. */

export const MODEL_OPTIONS = [
  { id: 'claude-fable-5[1m]', label: 'Fable 5 (1M)' },
  { id: 'claude-fable-5', label: 'Fable 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

export function displayModel(id?: string): string {
  if (!id) return '감지 중…';
  const found = MODEL_OPTIONS.find((m) => m.id === id || m.id.replace(/\[1m\]$/, '') === id);
  if (found) return found.label;
  return id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-/g, ' ');
}
