/**
 * "팀 프로젝트 만들기" scaffolding: creates a project folder plus one
 * subfolder per role from a hardcoded template (core/src/teamTemplates.ts),
 * and resolves a suggested roster from job presets (core/src/jobPresets.ts)
 * for the hire form to prefill.
 *
 * Safety posture (this writes to disk, unlike dirLister.ts's read-only
 * listing): create-only. An existing top-level project folder is refused
 * outright -- never merged into, never written into -- before anything is
 * created. If a later step fails, everything this call created is rolled
 * back, because the project folder itself is brand new (the existence check
 * above guarantees that), so removing it recursively cleans up exactly (and
 * only) what this call made.
 */
import * as fs from 'fs';
import * as path from 'path';

import { applyJobPreset } from '../../core/src/jobPresets.js';
import { findTeamTemplate, type TeamTemplateRole } from '../../core/src/teamTemplates.js';

/** One suggested hire for a role, already in the hire form's field shape
 *  (see HireEmployee in core/src/messages.ts) so the webview can drop it
 *  straight into the form without any translation. */
export interface ScaffoldRosterEntry {
  defaultName: string;
  org: 'lead' | 'staff';
  cwd: string;
  roleLabel: string;
  persona: string;
  model: string;
}

export type ScaffoldResult =
  | { ok: true; projectDir: string; createdDirs: string[]; roster: ScaffoldRosterEntry[] }
  | { ok: false; error: string };

/** Creates `<baseDir>/<projectName>/` plus each template role's subfolder,
 *  and returns the suggested roster. Never throws -- every failure mode
 *  (unknown template, bad name, existing path, a mkdir failing partway
 *  through) degrades to `{ ok: false, error }`. */
export function scaffoldTeamProject(
  templateKey: string,
  baseDir: string,
  projectName: string,
): ScaffoldResult {
  const template = findTeamTemplate(templateKey);
  if (!template) {
    return { ok: false, error: `알 수 없는 템플릿입니다: ${templateKey}` };
  }

  const name = projectName.trim();
  // No path separators or traversal -- projectName names a single new folder
  // directly under baseDir, it must not be able to escape it.
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') {
    return { ok: false, error: '프로젝트 이름이 비어 있거나 올바르지 않습니다.' };
  }
  // Windows reserved device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, with or
  // without an extension) create folders Explorer and cmd then can't open or
  // delete -- a baffling mess for the user. Refuse them on Windows. POSIX has no
  // such reservation, so a folder literally named "con" there is fine.
  if (process.platform === 'win32' && /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(name)) {
    return { ok: false, error: `Windows에서 예약된 이름이라 쓸 수 없습니다: ${name}` };
  }

  let resolvedBase: string;
  try {
    resolvedBase = path.resolve(baseDir);
  } catch {
    return { ok: false, error: `베이스 경로가 올바르지 않습니다: ${baseDir}` };
  }
  if (!fs.existsSync(resolvedBase) || !fs.statSync(resolvedBase).isDirectory()) {
    return { ok: false, error: `베이스 경로를 찾을 수 없습니다: ${resolvedBase}` };
  }

  const projectDir = path.join(resolvedBase, name);

  // Create-only: this runs before any mkdir, so a hit here creates nothing.
  if (fs.existsSync(projectDir)) {
    return { ok: false, error: `이미 존재하는 경로입니다: ${projectDir}` };
  }

  const createdDirs: string[] = [];
  try {
    fs.mkdirSync(projectDir);
    createdDirs.push(projectDir);

    for (const role of template.roles) {
      if (role.subfolder === '') continue; // '' = the project root itself (the lead), already created above
      const dir = path.join(projectDir, role.subfolder);
      fs.mkdirSync(dir, { recursive: true });
      createdDirs.push(dir);
    }
  } catch (err) {
    // Roll back ONLY what we actually created. createdDirs is empty iff the very
    // first mkdir (projectDir) failed -- which means projectDir either already
    // existed (a race between the existsSync check above and this mkdir) or was
    // never made. Either way it isn't ours, so we must never delete it.
    if (createdDirs.length > 0) {
      fs.rmSync(projectDir, { recursive: true, force: true });
    }
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `폴더 생성에 실패해 되돌렸습니다: ${message}` };
  }

  const roster = template.roles.map((role) => resolveRosterEntry(role, projectDir));
  return { ok: true, projectDir, createdDirs, roster };
}

function resolveRosterEntry(role: TeamTemplateRole, projectDir: string): ScaffoldRosterEntry {
  const cwd = role.subfolder === '' ? projectDir : path.join(projectDir, role.subfolder);
  const preset = role.presetKey ? applyJobPreset(role.presetKey) : undefined;
  const roleLabel = preset?.roleLabel ?? role.defaultRoleLabel;
  return {
    defaultName: roleLabel,
    org: role.org,
    cwd,
    roleLabel,
    persona: preset?.persona ?? '',
    model: preset?.model ?? '',
  };
}
