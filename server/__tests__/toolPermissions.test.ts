import { describe, expect, it } from 'vitest';

import {
  employeeKey,
  hasDangerousBashMetachars,
  normalizePath,
  pathMatches,
} from '../src/toolPermissions.js';

describe('toolPermissions', () => {
  describe('employeeKey', () => {
    // 허용목록의 키는 반드시 이름에서 나와야 한다. 세션 id로 키를 잡으면
    // /clear 하거나 퇴근·출근할 때마다 세션 id가 새로 발급되어, 사용자가
    // "다음부터 묻지 않기"로 쌓아둔 허용목록이 통째로 사라진다.
    it('같은 이름이면 항상 같은 키 — 세션이 바뀌어도 허용목록이 유지되어야 한다', () => {
      expect(employeeKey('사이트담당')).toBe(employeeKey('사이트담당'));
    });

    it('다른 이름이면 다른 키 — 한 직원의 허용이 다른 직원에게 새면 안 된다', () => {
      expect(employeeKey('사이트담당')).not.toBe(employeeKey('코더'));
    });

    // ClaudeEmployee.sessionId 는 세션이 스스로를 알리기 전까지 '' 다.
    // 그 상태로 키를 잡으면 일찍 움직인 직원들이 전부 '' 버킷을 공유한다.
    it('빈 이름도 빈 키를 만들지 않는다 — 공용 버킷이 생기면 허용이 새어나간다', () => {
      expect(employeeKey('')).not.toBe('');
    });

    it('공백만 다른 이름은 같은 키로 뭉개지지 않는다', () => {
      expect(employeeKey('김 만수')).not.toBe(employeeKey('김만수'));
    });
  });

  describe('hasDangerousBashMetachars', () => {
    it('blocks command chaining with ;', () => {
      expect(hasDangerousBashMetachars('ls; rm -rf /')).toBe(true);
    });

    it('blocks command chaining with &&', () => {
      expect(hasDangerousBashMetachars('npm run test && npm run build')).toBe(true);
    });

    it('blocks command chaining with ||', () => {
      expect(hasDangerousBashMetachars('npm run test || echo failed')).toBe(true);
    });

    it('blocks pipe operator', () => {
      expect(hasDangerousBashMetachars('cat file.txt | grep error')).toBe(true);
    });

    it('blocks backtick substitution', () => {
      expect(hasDangerousBashMetachars('echo `whoami`')).toBe(true);
    });

    it('blocks $(...) substitution', () => {
      expect(hasDangerousBashMetachars('echo $(whoami)')).toBe(true);
    });

    it('blocks redirection >', () => {
      expect(hasDangerousBashMetachars('echo test > file.txt')).toBe(true);
    });

    it('blocks redirection >>', () => {
      expect(hasDangerousBashMetachars('echo test >> file.txt')).toBe(true);
    });

    it('blocks redirection <', () => {
      expect(hasDangerousBashMetachars('cat < file.txt')).toBe(true);
    });

    it('allows safe command', () => {
      expect(hasDangerousBashMetachars('npm run test')).toBe(false);
    });

    it('allows ls command', () => {
      expect(hasDangerousBashMetachars('ls -la')).toBe(false);
    });

    it('allows glob *', () => {
      expect(hasDangerousBashMetachars('ls *.ts')).toBe(false);
    });

    it('allows spaces and quotes', () => {
      expect(hasDangerousBashMetachars('cat "path with space/file.txt"')).toBe(false);
    });

    it('blocks newline', () => {
      expect(hasDangerousBashMetachars('ls\nrm -rf /')).toBe(true);
    });
  });

  describe('normalizePath', () => {
    // 드라이브 문자만 소문자로 내리고 나머지 경로의 대소문자는 보존한다.
    // 전부 소문자로 내리면 안 된다 — Windows 파일시스템은 대소문자를 구분하지 않지만
    // 리눅스는 구분한다. 이 서버는 도커 컨테이너(리눅스)에서도 돌기 때문에,
    // 전부 소문자로 내리면 /home/User 와 /home/user 가 서로 다른 디렉터리인데도
    // 같다고 판정되어 허용목록이 의도보다 넓어진다.
    it('converts absolute path with backslashes on Windows', () => {
      const normalized = normalizePath('C:\\Users\\test');
      expect(normalized).toBe('c:/Users/test');
    });

    it('handles forward slashes', () => {
      const normalized = normalizePath('C:/Users/test');
      expect(normalized).toBe('c:/Users/test');
    });

    it('resolves relative paths', () => {
      const normalized = normalizePath('./src');
      expect(normalized).toMatch(/src$/);
    });

    it('handles mixed separators', () => {
      const normalized = normalizePath('F:/Projects\\ai-office');
      expect(normalized).toMatch(/f:\/Projects\/ai-office/);
    });
  });

  describe('pathMatches', () => {
    it('exact match returns true for identical paths', () => {
      expect(pathMatches('F:/Projects/ai-office', 'F:/Projects/ai-office', 'exact')).toBe(true);
    });

    it('exact match ignores case in drive letter', () => {
      expect(pathMatches('f:/Projects/ai-office', 'F:/Projects/ai-office', 'exact')).toBe(true);
    });

    it('exact match returns false for different paths', () => {
      expect(pathMatches('F:/Projects/ai-office', 'F:/Projects/ai-office-site', 'exact')).toBe(
        false,
      );
    });

    it('dirPrefix matches child directory', () => {
      expect(
        pathMatches(
          'F:/Projects/ai-office/webview-ui/src/file.ts',
          'F:/Projects/ai-office',
          'dirPrefix',
        ),
      ).toBe(true);
    });

    it('dirPrefix matches exact directory', () => {
      expect(pathMatches('F:/Projects/ai-office', 'F:/Projects/ai-office', 'dirPrefix')).toBe(true);
    });

    it('dirPrefix rejects non-child directory', () => {
      // ai-office-site is NOT under ai-office
      expect(
        pathMatches('F:/Projects/ai-office-site/file.ts', 'F:/Projects/ai-office', 'dirPrefix'),
      ).toBe(false);
    });

    it('dirPrefix rejects sibling directory', () => {
      expect(
        pathMatches('F:/Projects/ai-office-2/src/file.ts', 'F:/Projects/ai-office', 'dirPrefix'),
      ).toBe(false);
    });

    it('dirPrefix is segment-boundary aware', () => {
      // ai-office-ext should NOT match ai-office prefix
      expect(
        pathMatches('F:/Projects/ai-office-ext/file.ts', 'F:/Projects/ai-office', 'dirPrefix'),
      ).toBe(false);
    });
  });
});
