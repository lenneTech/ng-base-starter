import type { LtAiPromptHint, LtAiPromptHintInput } from '@lenne.tech/ng-base/ai';

/**
 * Learned prompt hints, from the Nuxt template's `prompt-hints.vue`: the governed self-improvement loop suggests a hint
 * per recurring failure pattern; only approved and enabled hints reach the prompt.
 */

/** Governance status of a hint. */
export type AiHintStatus = 'approved' | 'rejected' | 'suggested';

/** A hint without status is a suggestion. */
export function hintStatus(hint: LtAiPromptHint): string {
  return hint.status || 'suggested';
}

/** "Zu prüfen" (suggestions) and "Geprüfte Hinweise" (everything else). */
export function partitionHints(hints: readonly LtAiPromptHint[]): { reviewed: LtAiPromptHint[]; suggested: LtAiPromptHint[] } {
  return {
    reviewed: hints.filter((hint) => hintStatus(hint) !== 'suggested'),
    suggested: hints.filter((hint) => hintStatus(hint) === 'suggested'),
  };
}

/** Whether the hint is active (missing means active). */
export function isHintEnabled(hint: LtAiPromptHint): boolean {
  return hint.enabled !== false;
}

/** The "Manuellen Hinweis anlegen" form. */
export interface HintFormModel {
  content: string;
  scope: string;
}

export const HINT_CONTENT_MESSAGE = 'Bitte einen Hinweistext angeben.';

export function emptyHintForm(): HintFormModel {
  return { content: '', scope: '' };
}

/**
 * The request body of a manual hint, or `null` without a text. A manual hint is approved at once; an empty scope
 * means global.
 */
export function buildManualHintInput(model: HintFormModel): LtAiPromptHintInput | null {
  if (!model.content.trim()) {
    return null;
  }
  return { content: model.content, scope: model.scope.trim() || undefined, status: 'approved', trigger: 'manual' };
}
