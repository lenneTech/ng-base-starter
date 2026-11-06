import type { LtAiPrompt, LtAiPromptInput } from '@lenne.tech/ng-base/ai';
import type { LtSelectOption } from '@lenne.tech/ng-base/ui';

/** The prompt form of `/app/settings/ai-prompts` ("Neue Vorlage" / "Vorlage bearbeiten"). */
export interface AiPromptDraft {
  content: string;
  description: string;
  enabled: boolean;
  /** Lucide name (`i-lucide-mail`) or an emoji. */
  icon: string;
  name: string;
  /** Sort order in the picker; `null` while the number field is empty. */
  order: null | number;
  /** `user` (private) or `tenant` (shared with the tenant). */
  scope: string;
}

/** Default sort order of a prompt. */
export const DEFAULT_PROMPT_ORDER = 100;

/** Choices of the "Sichtbarkeit" select. */
export const PROMPT_SCOPE_OPTIONS: LtSelectOption<string>[] = [
  { label: 'Nur für mich (privat)', value: 'user' },
  { label: 'Mit dem Tenant teilen (öffentlich)', value: 'tenant' },
];

/** An empty form: private, active, order 100. */
export function emptyPromptDraft(): AiPromptDraft {
  return { content: '', description: '', enabled: true, icon: '', name: '', order: DEFAULT_PROMPT_ORDER, scope: 'user' };
}

/** The form filled with an existing prompt (missing fields get the defaults of a new one). */
export function promptToDraft(prompt: LtAiPrompt): AiPromptDraft {
  return {
    content: prompt.content || '',
    description: prompt.description || '',
    enabled: prompt.enabled !== false,
    icon: prompt.icon || '',
    name: prompt.name || '',
    order: prompt.order ?? DEFAULT_PROMPT_ORDER,
    scope: prompt.scope || 'user',
  };
}

/** The first reason the form cannot be saved (name, then content), or `null`. */
export function promptDraftError(draft: Pick<AiPromptDraft, 'content' | 'name'>): null | string {
  if (!draft.name.trim()) {
    return 'Bitte einen Namen angeben.';
  }
  if (!draft.content.trim()) {
    return 'Bitte einen Inhalt angeben.';
  }
  return null;
}

/** The payload of `LtAiPromptsService.create()` / `.update()`; an emptied order field is left out. */
export function promptDraftToInput(draft: AiPromptDraft): LtAiPromptInput {
  const { order, ...rest } = draft;
  return order === null || Number.isNaN(order) ? rest : { ...rest, order };
}
