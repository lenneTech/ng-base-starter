import { booleanAttribute, Component, computed, input } from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';

import { PROMPT_ICONS, promptIconName, promptIconText } from './prompt-icons';

/**
 * The icon of a prompt: a Lucide icon of the curated set ({@link PROMPT_ICONS}), or the emoji the user entered.
 * Decorative (the prompt's name carries the meaning), so hidden from assistive technology.
 */
@Component({
  imports: [NgIcon],
  providers: [provideIcons(PROMPT_ICONS)],
  selector: 'app-ai-prompt-icon',
  host: { class: 'contents' },
  templateUrl: './ai-prompt-icon.html',
})
export class AiPromptIcon {
  /** The prompt's `icon` value. */
  readonly icon = input<string>();
  /** Show an emoji value as text (the picker shows icons only, like the Nuxt menu). */
  readonly showText = input(true, { transform: booleanAttribute });

  protected readonly iconName = computed(() => promptIconName(this.icon()));
  protected readonly text = computed(() => (this.showText() ? promptIconText(this.icon()) : undefined));
}
