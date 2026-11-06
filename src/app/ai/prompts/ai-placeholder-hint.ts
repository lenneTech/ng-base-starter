import { afterNextRender, Component, computed, inject } from '@angular/core';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAiPlaceholdersService } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmCardImports, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBraces, lucideCopy, lucideLoaderCircle } from '@ng-icons/lucide';

import { placeholderToken } from './placeholder-token';

/**
 * Sidebar of the prompt settings: every `{{placeholder}}` the backend supports (`GET /ai/placeholders`, registry-driven,
 * so project-specific placeholders show up without a frontend change). Activating an entry copies its token.
 */
@Component({
  imports: [HlmBadge, HlmCardImports, LtNotice, NgIcon],
  providers: [provideIcons({ lucideBraces, lucideCopy, lucideLoaderCircle })],
  selector: 'app-ai-placeholder-hint',
  templateUrl: './ai-placeholder-hint.html',
})
export class AiPlaceholderHint {
  protected readonly placeholders = inject(LtAiPlaceholdersService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly toast = inject(LtToastService);

  protected readonly token = placeholderToken;
  protected readonly exampleToken = placeholderToken('name');
  protected readonly errorText = computed(() => {
    const error = this.placeholders.error();
    return error ? this.errors.translateError(error) : null;
  });

  constructor() {
    afterNextRender(() => void this.placeholders.load());
  }

  protected async copy(name: string): Promise<void> {
    const token = placeholderToken(name);
    try {
      await navigator.clipboard.writeText(token);
      this.toast.show({ color: 'success', description: `${token} kopiert`, title: 'Platzhalter' });
    } catch {
      this.toast.show({ color: 'error', description: 'Zwischenablage nicht verfügbar', title: 'Fehler' });
    }
  }
}
