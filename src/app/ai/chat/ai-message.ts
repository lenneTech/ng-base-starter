import { Component, computed, input, output } from '@angular/core';
import type { LtAiMessage } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmButton, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideTriangleAlert, lucideX } from '@ng-icons/lucide';

/**
 * One chat message (user or assistant): the streamed or final text, the tool actions that ran, the "nothing was
 * executed" notice of a denied turn, and the confirmation gate for mutating or destructive actions.
 */
@Component({
  imports: [HlmBadge, HlmButton, LtNotice, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideTriangleAlert, lucideX })],
  selector: 'app-ai-message',
  templateUrl: './ai-message.html',
})
export class AiMessage {
  readonly message = input.required<LtAiMessage>();
  /** The user approved the pending actions ("Ausführung bestätigen"). */
  readonly confirmed = output<void>();

  protected readonly isUser = computed(() => this.message().role === 'user');
}
