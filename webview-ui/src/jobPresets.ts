/** Re-exported from core -- the server's team-scaffolding templates
 *  (teamTemplates.ts) resolve role defaults from the exact same presets, so
 *  the data lives in core/src/jobPresets.ts and both sides import it from
 *  there. Kept as its own file (instead of updating every import site to
 *  point at core directly) so the hire form's existing imports don't churn. */
export type { JobPreset, JobPresetFields } from '../../core/src/jobPresets.js';
export { applyJobPreset, JOB_PRESETS } from '../../core/src/jobPresets.js';
