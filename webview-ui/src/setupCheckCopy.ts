/**
 * Korean copy for onboarding setup-check results — kept separate from the
 * server so remediation wording can change without touching the protocol
 * (see setupCheck.ts on the server: it reports evidence only, no copy).
 *
 * The SetupCheck* types are defined HERE, not in useExtensionMessages.ts,
 * which instead re-exports them — same reason permissionQueue.ts keeps
 * PermissionRequest apart from the hook that re-exports it: this file (and
 * its test) must never have to pull in useExtensionMessages.ts, which uses
 * `window`/DOM APIs that webview-ui's Node-side tsconfig (covering
 * vite.config.ts and test/**) does not have `lib: DOM` for.
 */

export type SetupCheckId = 'claudeInstalled' | 'claudeLoggedIn' | 'apiKeyFormat' | 'apiKeyValid';

export type SetupCheckStatus = 'ok' | 'fail' | 'skip';

export interface SetupCheck {
  id: SetupCheckId;
  status: SetupCheckStatus;
  /** Evidence backing the status (CLI version, stderr line, HTTP status).
   *  Korean remediation copy is generated below, not carried in this field. */
  detail?: string;
}

export interface SetupCheckCopy {
  label: string;
  /** Secondary line: remediation guidance on failure, or the credit caveat
   *  on a passing apiKeyValid check. Undefined = nothing to add. */
  message?: string;
  /** Only set for claudeInstalled/fail — a place to point at install docs. */
  docsUrl?: string;
}

const LABELS: Record<SetupCheck['id'], string> = {
  claudeInstalled: 'Claude Code 설치',
  claudeLoggedIn: 'Claude Code 로그인',
  apiKeyFormat: 'API 키 형식',
  apiKeyValid: 'API 키 유효성',
};

const CLAUDE_CODE_DOCS_URL = 'https://code.claude.com/docs/en/overview';

export function setupCheckCopy(check: SetupCheck): SetupCheckCopy {
  const label = LABELS[check.id];

  switch (check.id) {
    case 'claudeInstalled':
      if (check.status === 'fail') {
        return {
          label,
          message:
            'Claude Code가 없거나 PATH에 없습니다. `npm i -g @anthropic-ai/claude-code` 후 터미널을 재시작하세요.',
          docsUrl: CLAUDE_CODE_DOCS_URL,
        };
      }
      return { label };

    case 'claudeLoggedIn':
      if (check.status === 'fail') {
        return {
          label,
          message:
            '로그인 안 됨. 터미널에서 `claude`를 실행해 로그인한 뒤 [다시 검사]를 눌러주세요.',
        };
      }
      return { label };

    case 'apiKeyFormat':
      if (check.status === 'fail') {
        return { label, message: '키가 비어 있거나 `sk-ant-`로 시작하지 않습니다.' };
      }
      return { label };

    case 'apiKeyValid':
      if (check.status === 'fail') {
        return {
          label,
          message: '키가 거부됐습니다(401). console.anthropic.com에서 재발급하세요.',
        };
      }
      if (check.status === 'ok') {
        return {
          label,
          message: '키는 유효합니다. 단 결제수단/크레딧이 없으면 첫 대화에서 실패할 수 있습니다.',
        };
      }
      return { label };
  }
}
