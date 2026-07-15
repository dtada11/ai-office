/** Pure preview logic for "팀 프로젝트 만들기": turns a template plus the
 *  chosen base folder and project name into the folder tree and roster that
 *  will be created, without touching the filesystem or the network. Kept
 *  separate from the modal's rendering/fetch layer (like folderPicker.ts is
 *  to FolderPicker.tsx) so the preview can be unit tested without a DOM or a
 *  server round-trip. The real creation only happens when the user approves
 *  this preview and POST /api/scaffold-team is called. */

import { applyJobPreset } from '../../core/src/jobPresets.js';
import type { TeamTemplate } from '../../core/src/teamTemplates.js';

export interface ScaffoldPreviewRole {
  roleLabel: string;
  org: 'lead' | 'staff';
  /** Approximate absolute path this role will get, built with a guessed
   *  separator ('\\' if baseDir looks like a Windows path, else '/') purely
   *  for display -- the server resolves the real path with `path.join` when
   *  it actually creates the folders. */
  cwd: string;
}

export interface ScaffoldPreview {
  projectDir: string;
  /** Every directory that will be created, including the project root. */
  dirs: string[];
  roster: ScaffoldPreviewRole[];
}

/** Builds the preview, or null when baseDir/projectName aren't filled in yet
 *  (nothing to preview). Never touches disk. */
export function buildScaffoldPreview(
  template: TeamTemplate,
  baseDir: string,
  projectName: string,
): ScaffoldPreview | null {
  const base = baseDir.trim();
  const name = projectName.trim();
  if (!base || !name) return null;

  const sep = base.includes('\\') ? '\\' : '/';
  const trimmedBase = base.endsWith(sep) ? base.slice(0, -1) : base;
  const projectDir = `${trimmedBase}${sep}${name}`;

  const dirs = [projectDir];
  const roster: ScaffoldPreviewRole[] = template.roles.map((role) => {
    const cwd = role.subfolder === '' ? projectDir : `${projectDir}${sep}${role.subfolder}`;
    if (role.subfolder !== '') dirs.push(cwd);
    const roleLabel = role.presetKey
      ? (applyJobPreset(role.presetKey)?.roleLabel ?? role.defaultRoleLabel)
      : role.defaultRoleLabel;
    return { roleLabel, org: role.org, cwd };
  });

  return { projectDir, dirs, roster };
}
