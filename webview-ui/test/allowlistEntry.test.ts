import { describe, expect, it } from 'vitest';

import { allowlistEntryFor, dirOf, parseToolInput } from '../src/components/allowlistEntry.js';

describe('allowlistEntry', () => {
  describe('parseToolInput', () => {
    // 서버는 input 을 JSON 문자열로 보낸다. 이걸 객체로만 다루면 조용히 {} 가 되어
    // 허용목록 항목이 만들어지지 않고, 버튼은 승인만 하고 아무것도 저장하지 않는다.
    // 타입 오류도, 화면 오류도 안 난다 — 그래서 테스트로 잡는다.
    it('JSON 문자열을 객체로 푼다 — 서버가 실제로 이 형태로 보낸다', () => {
      expect(
        parseToolInput('{"file_path":"F:\\\\Projects\\\\ai-office\\\\.editorconfig"}'),
      ).toEqual({
        file_path: 'F:\\Projects\\ai-office\\.editorconfig',
      });
    });

    it('객체로 와도 그대로 받는다', () => {
      expect(parseToolInput({ command: 'ls -la' })).toEqual({ command: 'ls -la' });
    });

    it('깨진 JSON 은 빈 객체 — 클릭 핸들러 안에서 throw 하지 않는다', () => {
      expect(parseToolInput('{not json')).toEqual({});
    });

    it('null 이나 문자열 리터럴도 빈 객체', () => {
      expect(parseToolInput(null)).toEqual({});
      expect(parseToolInput('"hello"')).toEqual({});
    });
  });

  describe('dirOf', () => {
    it('Windows 구분자', () => {
      expect(dirOf('F:\\Projects\\ai-office\\.nvmrc')).toBe('F:\\Projects\\ai-office');
    });

    it('POSIX 구분자 — 컨테이너 안에서는 이쪽이다', () => {
      expect(dirOf('/workspace/site/index.html')).toBe('/workspace/site');
    });
  });

  describe('allowlistEntryFor', () => {
    // 폴더가 아니라 파일 경로를 저장하면 dirPrefix 가 그 파일 하나만 매칭해서,
    // 같은 폴더의 다음 파일에서 또 물어본다. 버튼의 존재 이유가 사라진다.
    it('Read 는 파일이 아니라 폴더를 담는다', () => {
      expect(
        allowlistEntryFor('Read', '{"file_path":"F:\\\\Projects\\\\ai-office\\\\.editorconfig"}'),
      ).toEqual({ match: 'dirPrefix', value: 'F:\\Projects\\ai-office' });
    });

    it('Bash 는 정확 일치 — 접두사면 승인된 명령 뒤에 뭐든 붙는다', () => {
      expect(allowlistEntryFor('Bash', '{"command":"npm run test"}')).toEqual({
        match: 'exact',
        value: 'npm run test',
      });
    });

    // 파일을 바꾸는 권한을 상시로 넘기는 것이 결재함이 막으려는 바로 그것이다.
    it('Write·Edit 은 항목을 만들지 않는다 — 버튼이 뜨면 안 된다', () => {
      expect(allowlistEntryFor('Write', '{"file_path":"F:\\\\x\\\\a.ts"}')).toBeNull();
      expect(allowlistEntryFor('Edit', '{"file_path":"F:\\\\x\\\\a.ts"}')).toBeNull();
    });

    it('모르는 도구는 항목 없음 — fail-closed', () => {
      expect(allowlistEntryFor('WebFetch', '{"url":"https://example.com"}')).toBeNull();
    });

    it('경로가 없으면 항목 없음', () => {
      expect(allowlistEntryFor('Read', '{}')).toBeNull();
      expect(allowlistEntryFor('Bash', '{}')).toBeNull();
    });
  });
});
