import { afterNextRender, Component, computed, inject, output } from '@angular/core';
import { LtErrorTranslationService } from '@lenne.tech/ng-base';
import { type LtAiPrompt, LtAiPromptsService } from '@lenne.tech/ng-base/ai';
import { HlmButton, HlmDropdownMenuImports } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardList, lucideLoaderCircle } from '@ng-icons/lucide';

import { AiPromptIcon } from '../prompts/ai-prompt-icon';
import { groupPrompts } from '../prompts/prompt-list';

/**
 * Prompt ("Vorlage") menu next to the chat input: every prompt the user may see (own private ones, then the tenant's
 * shared ones), grouped by scope. Emits the picked prompt; the chat inserts its content into the draft.
 */
@Component({
  imports: [AiPromptIcon, HlmButton, HlmDropdownMenuImports, NgIcon],
  providers: [provideIcons({ lucideClipboardList, lucideLoaderCircle })],
  selector: 'app-ai-prompt-picker',
  templateUrl: './ai-prompt-picker.html',
})
export class AiPromptPicker {
  /** The prompt the user picked. */
  readonly selected = output<LtAiPrompt>();

  protected readonly prompts = inject(LtAiPromptsService);
  private readonly errors = inject(LtErrorTranslationService);

  protected readonly groups = computed(() => groupPrompts(this.prompts.enabledPrompts()));
  protected readonly errorText = computed(() => {
    const error = this.prompts.error();
    return error ? this.errors.translateError(error) : null;
  });

  constructor() {
    afterNextRender(() => void this.prompts.load());
  }

  protected pick(prompt: LtAiPrompt): void {
    this.selected.emit(prompt);
  }
}
