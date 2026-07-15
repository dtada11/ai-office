import { describe, expect, it } from 'vitest';

import { applyJobPreset, JOB_PRESETS } from '../../core/src/jobPresets.js';
import { TEAM_TEMPLATES } from '../../core/src/teamTemplates.js';

// Every presetKey a template role names has to resolve to a real job preset --
// otherwise teamScaffold.ts silently falls back to the role's defaultRoleLabel
// (plain title, no persona/model) and a hire would go out half-filled.
describe('team templates <-> job presets consistency', () => {
  it('every role presetKey resolves to a real job preset', () => {
    for (const template of TEAM_TEMPLATES) {
      for (const role of template.roles) {
        if (role.presetKey === undefined) continue; // the lead: intentionally has no preset
        expect(
          applyJobPreset(role.presetKey),
          `template "${template.key}" role "${role.subfolder || '(root)'}" references unknown preset "${role.presetKey}"`,
        ).toBeDefined();
      }
    }
  });

  it('the lead role never carries a presetKey (leads delegate, not do one job)', () => {
    for (const template of TEAM_TEMPLATES) {
      const lead = template.roles.find((r) => r.org === 'lead');
      expect(lead).toBeDefined();
      expect(lead?.presetKey).toBeUndefined();
      expect(lead?.subfolder).toBe('');
    }
  });

  it('every template has unique subfolders (no two roles collide on one folder)', () => {
    for (const template of TEAM_TEMPLATES) {
      const subfolders = template.roles.map((r) => r.subfolder);
      expect(new Set(subfolders).size).toBe(subfolders.length);
    }
  });

  it('every template key is unique', () => {
    const keys = TEAM_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sanity: presetKeys used across templates are a subset of JOB_PRESETS ids', () => {
    const presetIds = new Set(JOB_PRESETS.map((p) => p.id));
    const usedKeys = TEAM_TEMPLATES.flatMap((t) => t.roles.map((r) => r.presetKey)).filter(
      (k): k is string => k !== undefined,
    );
    for (const key of usedKeys) {
      expect(presetIds.has(key)).toBe(true);
    }
  });
});
