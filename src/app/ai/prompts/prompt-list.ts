import type { LtAiPrompt } from '@lenne.tech/ng-base/ai';

/** The two visibility groups of the prompt picker and the prompt settings. */
export type AiPromptGroupKey = 'tenant' | 'user';

/** A non-empty group of prompts with its heading. */
export interface AiPromptGroup {
  key: AiPromptGroupKey;
  label: string;
  prompts: LtAiPrompt[];
}

/** Group order (own prompts first) and headings. */
const GROUPS: ReadonlyArray<readonly [AiPromptGroupKey, string]> = [
  ['user', 'Eigene (privat)'],
  ['tenant', 'Geteilt (Tenant)'],
];

/**
 * The visible prompts by scope, own (`user`) before shared (`tenant`), in the order the server returned them; empty
 * groups are left out. A prompt of another scope (e.g. `global`) is in neither group, as in the Nuxt template.
 */
export function groupPrompts(prompts: readonly LtAiPrompt[]): AiPromptGroup[] {
  return GROUPS.map(([key, label]) => ({ key, label, prompts: prompts.filter((prompt) => prompt.scope === key) })).filter((group) => group.prompts.length > 0);
}

/**
 * Whether the UI offers edit and delete: admins for every prompt, everyone else for their own. A UI decision only; the
 * server enforces owner-only mutations. Without a known user id nothing counts as own (a prompt without `ownerId` is
 * not "owned" by a user whose id is not loaded yet).
 */
export function canMutatePrompt(prompt: Pick<LtAiPrompt, 'ownerId'>, userId: string | undefined, isAdmin: boolean): boolean {
  return isAdmin || (!!userId && prompt.ownerId === userId);
}
