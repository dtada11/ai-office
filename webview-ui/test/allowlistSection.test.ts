/**
 * The settings panel's "자동 허용" section: the display helpers, and what the
 * component actually renders.
 *
 * Rendered with renderToStaticMarkup rather than a DOM harness — this suite runs
 * under the webview's node environment (vitest.config.ts), and the section is
 * static markup with one callback, so there is nothing here a DOM would show
 * that the HTML does not. Keeping it DOM-free means no jsdom switch for the
 * other suites.
 *
 * createElement instead of JSX because the config only picks up test/*.test.ts.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { AllowlistEmployee } from '../../core/src/messages.js';
import { entryDetail, formatAddedAt, matchLabel } from '../src/components/allowlistFormat.js';
import { AllowlistSection } from '../src/components/AllowlistSection.js';

/** Local time, built from parts: a UTC literal would render as a different
 *  hour:minute depending on where the test runs, and the hour is the assertion. */
function localIso(month: number, day: number, hour: number, minute: number): string {
  return new Date(2026, month - 1, day, hour, minute).toISOString();
}

function render(employees: AllowlistEmployee[]): string {
  return renderToStaticMarkup(createElement(AllowlistSection, { employees, onRemove: () => {} }));
}

describe('formatAddedAt', () => {
  // 날짜만 보여주면 같은 날 두 번 허용한 걸 구분할 수 없다 — 사용자가 "내가 뭘
  // 눌렀지"를 떠올리는 건 바로 그 상황이다.
  it('날짜와 시분을 모두 보여준다', () => {
    expect(formatAddedAt(localIso(7, 17, 14, 32))).toBe('7월17일 14:32');
  });

  it('한 자리 시분은 0을 채운다 — 9:5 가 아니라 09:05', () => {
    expect(formatAddedAt(localIso(7, 17, 9, 5))).toBe('7월17일 09:05');
  });

  it('자정도 24:00 이 아니라 00:00', () => {
    expect(formatAddedAt(localIso(12, 1, 0, 0))).toBe('12월1일 00:00');
  });

  // 파일이 깨졌다고 패널에 "Invalid Date"가 뜨면 안 된다.
  it('못 읽는 값이면 빈 문자열', () => {
    expect(formatAddedAt('nonsense')).toBe('');
    expect(formatAddedAt('')).toBe('');
  });
});

describe('matchLabel', () => {
  it('dirPrefix 는 하위 전체', () => {
    expect(matchLabel('dirPrefix')).toBe('하위 전체');
  });

  it('exact 는 정확히 이 명령', () => {
    expect(matchLabel('exact')).toBe('정확히 이 명령');
  });
});

describe('entryDetail', () => {
  it('match 설명과 추가 시각을 한 줄로 붙인다', () => {
    expect(entryDetail('dirPrefix', localIso(7, 17, 14, 32))).toBe('하위 전체 · 7월17일 14:32');
  });

  it('시각을 못 읽으면 설명만 남기고 · 을 남기지 않는다', () => {
    expect(entryDetail('exact', 'nonsense')).toBe('정확히 이 명령');
  });
});

describe('AllowlistSection', () => {
  it('직원 이름으로 묶고 도구·값·설명·추가 시각을 모두 렌더한다', () => {
    const html = render([
      {
        agentId: 1,
        name: '사이트담당',
        allow: [
          {
            tool: 'Read',
            match: 'dirPrefix',
            value: 'F:\\Projects\\ai-office',
            addedAt: localIso(7, 17, 14, 32),
          },
        ],
      },
    ]);

    expect(html).toContain('사이트담당');
    expect(html).toContain('Read');
    expect(html).toContain('F:\\Projects\\ai-office');
    expect(html).toContain('하위 전체 · 7월17일 14:32');
  });

  // 이름이 아예 없으면 "그런 직원 없음"으로 읽힌다. 질문은 "내가 뭘 허용해뒀나"이고,
  // "아무것도 안 했다"는 그 질문의 답이다 — 답을 지우면 안 된다.
  it('허용 항목이 0개인 직원도 이름과 함께 나오고, 밑에 없다고 알린다', () => {
    const html = render([{ agentId: 2, name: '기획담당', allow: [] }]);

    expect(html).toContain('기획담당');
    expect(html).toContain('자동 허용한 항목이 없습니다');
  });

  it('항목이 있는 직원에게는 "없습니다"가 뜨지 않는다', () => {
    const html = render([
      {
        agentId: 1,
        name: '사이트담당',
        allow: [
          { tool: 'Bash', match: 'exact', value: 'npm run test', addedAt: localIso(7, 17, 15, 1) },
        ],
      },
    ]);

    expect(html).not.toContain('자동 허용한 항목이 없습니다');
    expect(html).toContain('정확히 이 명령 · 7월17일 15:01');
  });

  it('항목마다 삭제 버튼이 하나씩 붙는다', () => {
    const html = render([
      {
        agentId: 1,
        name: '사이트담당',
        allow: [
          { tool: 'Bash', match: 'exact', value: 'npm run test', addedAt: localIso(7, 17, 15, 1) },
          {
            tool: 'Read',
            match: 'dirPrefix',
            value: 'F:\\Projects',
            addedAt: localIso(7, 17, 14, 32),
          },
        ],
      },
      { agentId: 2, name: '기획담당', allow: [] },
    ]);

    expect(html.match(/data-testid="remove-allowlist-entry"/g)).toHaveLength(2);
  });
});
