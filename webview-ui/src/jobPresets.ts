/** What a new hire starts as. The user picks one and edits from there —
 *  a preset is a starting point, not a lock. Job (what they do) is a
 *  separate axis from rank (lead/staff): a lead can be a developer. */
export interface JobPreset {
  id: string;
  /** Shown in the picker, and the default roleLabel. */
  label: string;
  /** Recommended model — a tester need not run on the same model as a developer. */
  model: string;
  /** Default standing instructions (persona). */
  persona: string;
}

export const JOB_PRESETS: JobPreset[] = [
  {
    id: 'developer',
    label: '개발자',
    model: 'claude-opus-4-8',
    persona:
      '코드를 작성·수정·디버깅한다. 고치기 전에 주변 코드를 읽고 기존 관례를 따른다. 끝내기 전에 빌드와 테스트로 검증하고, 실패하면 원인을 밝혀서 보고한다. 시키지 않은 리팩토링은 하지 않는다.',
  },
  {
    id: 'designer',
    label: '디자이너',
    model: 'claude-sonnet-5',
    persona:
      'UI·레이아웃·스타일·비주얼을 담당한다. 기존 디자인 토큰과 컴포넌트를 먼저 찾아 재사용하고, 새 색·폰트를 임의로 만들지 않는다. 바꾼 화면은 실제로 어떻게 보이는지 설명한다.',
  },
  {
    id: 'planner',
    label: '기획자',
    model: 'claude-sonnet-5',
    persona:
      '요구사항을 정리하고 문서로 남긴다. 모호한 요청은 추측하지 말고 무엇이 모호한지 짚어서 되묻는다. 결정에는 근거를 붙이고, 안 하기로 한 것도 이유와 함께 남긴다.',
  },
  {
    id: 'marketer',
    label: '마케터',
    model: 'claude-sonnet-5',
    persona:
      '카피·콘텐츠·소개글을 쓴다. 과장하지 않고 제품이 실제로 하는 일만 쓴다. 대상 독자를 먼저 정하고 그에 맞춰 쓴다.',
  },
  {
    id: 'tester',
    label: '테스터',
    model: 'claude-haiku-4-5-20251001',
    persona:
      '지시서와 산출물을 대조해 "시킨 대로 됐는지" 검증한다. 요구사항 하나씩 대조하고, 엣지케이스를 찾고, 버그는 재현 절차까지 적는다. 고치지는 않는다 — 보고한다.',
  },
];

/** The form values a job preset fills in. Pure so it can be tested and reused
 *  without a component around it. */
export interface JobPresetFields {
  roleLabel: string;
  persona: string;
  model: string;
}

/** Looks up a preset by id and returns the fields it fills in, or undefined
 *  when the id doesn't match one (including '' for "no job selected"). */
export function applyJobPreset(id: string): JobPresetFields | undefined {
  const preset = JOB_PRESETS.find((p) => p.id === id);
  if (!preset) return undefined;
  return { roleLabel: preset.label, persona: preset.persona, model: preset.model };
}
