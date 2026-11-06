import type { LtAiPromptHint } from '@lenne.tech/ng-base/ai';

import { buildManualHintInput, emptyHintForm, hintStatus, isHintEnabled, partitionHints } from './prompt-hint-model';

const suggestion: LtAiPromptHint = { content: 'Nutze das Tool x', id: 'h1' };
const approved: LtAiPromptHint = { content: 'Frage nach', id: 'h2', status: 'approved' };
const rejected: LtAiPromptHint = { content: 'Ignoriere y', enabled: false, id: 'h3', status: 'rejected' };

describe('hint status', () => {
  it('treats a hint without status as a suggestion', () => {
    expect(hintStatus(suggestion)).toBe('suggested');
    expect(hintStatus(approved)).toBe('approved');
  });

  it('splits suggestions from reviewed hints', () => {
    expect(partitionHints([suggestion, approved, rejected, { ...suggestion, id: 'h4', status: 'suggested' }])).toEqual({
      reviewed: [approved, rejected],
      suggested: [suggestion, { ...suggestion, id: 'h4', status: 'suggested' }],
    });
  });

  it('treats a missing enabled flag as active', () => {
    expect(isHintEnabled(suggestion)).toBe(true);
    expect(isHintEnabled(rejected)).toBe(false);
  });
});

describe('buildManualHintInput', () => {
  it('needs a text', () => {
    expect(buildManualHintInput(emptyHintForm())).toBeNull();
    expect(buildManualHintInput({ content: '   ', scope: 'x' })).toBeNull();
  });

  it('approves a manual hint at once and sends an empty scope as global', () => {
    expect(buildManualHintInput({ content: 'Frage nach', scope: '  ' })).toEqual({ content: 'Frage nach', scope: undefined, status: 'approved', trigger: 'manual' });
    expect(buildManualHintInput({ content: 'Frage nach', scope: ' createUser ' })).toMatchObject({ scope: 'createUser' });
  });
});
