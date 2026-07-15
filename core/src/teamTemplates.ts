/** Hardcoded folder-structure templates for "팀 프로젝트 만들기" scaffolding.
 *  Each staff role maps to a job preset (jobPresets.ts) for its default
 *  title/persona/model -- the lead is the exception: leads delegate rather
 *  than do one specific job, so they have no preset and just keep the plain
 *  "팀장" label already used everywhere else in the hire flow.
 *
 *  Shared by the server (which actually creates these folders and resolves
 *  the suggested roster -- server/src/teamScaffold.ts) and the webview
 *  (which renders the template picker and a pre-creation preview --
 *  webview-ui/src/teamScaffoldPreview.ts) so both sides work off the exact
 *  same shape without duplicating it. */
export interface TeamTemplateRole {
  org: 'lead' | 'staff';
  /** Path relative to the project root. '' = the root itself (the lead's cwd). */
  subfolder: string;
  /** Job preset id (jobPresets.ts) this role's title/persona/model come from.
   *  Undefined for the lead role. */
  presetKey?: string;
  /** Label used when there's no preset (lead), or as a fallback if a
   *  presetKey ever stops matching a real preset. */
  defaultRoleLabel: string;
}

export interface TeamTemplate {
  key: string;
  label: string;
  roles: TeamTemplateRole[];
}

export const TEAM_TEMPLATES: TeamTemplate[] = [
  {
    key: 'pure-dev',
    label: '순수 개발',
    roles: [
      { org: 'lead', subfolder: '', defaultRoleLabel: '팀장' },
      { org: 'staff', subfolder: 'src', presetKey: 'developer', defaultRoleLabel: '개발자' },
      { org: 'staff', subfolder: 'tests', presetKey: 'tester', defaultRoleLabel: '테스터' },
    ],
  },
  {
    key: 'product-team',
    label: '제품팀',
    roles: [
      { org: 'lead', subfolder: '', defaultRoleLabel: '팀장' },
      { org: 'staff', subfolder: 'docs', presetKey: 'planner', defaultRoleLabel: '기획' },
      { org: 'staff', subfolder: 'src', presetKey: 'developer', defaultRoleLabel: '개발' },
      { org: 'staff', subfolder: 'marketing', presetKey: 'marketer', defaultRoleLabel: '마케팅' },
    ],
  },
];

/** Looks up a template by key, or undefined if it doesn't match one. */
export function findTeamTemplate(key: string): TeamTemplate | undefined {
  return TEAM_TEMPLATES.find((t) => t.key === key);
}
