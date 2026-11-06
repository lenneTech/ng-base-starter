import { DOCUMENT } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { LtAiPlaceholdersService } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmCardImports, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideBraces, lucideCopy, lucideLoaderCircle } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { placeholderToken } from './placeholder-token';

/**
 * Placeholder helper sidebar of the slot editor (the counterpart of `AiPlaceholderHint.vue`): every `{{placeholder}}`
 * the backend supports, registry-driven (`GET /ai/placeholders`), so project-specific additions show up without a
 * frontend change. Clicking an entry copies its token.
 */
@Component({
  imports: [HlmBadge, HlmCardImports, LtNotice, NgIcon],
  providers: [provideIcons({ lucideBraces, lucideCopy, lucideLoaderCircle })],
  selector: 'app-placeholder-hint',
  templateUrl: './placeholder-hint.html',
})
export class PlaceholderHint {
  private readonly document = inject(DOCUMENT);
  private readonly feedback = injectAiAdminFeedback();
  protected readonly placeholders = inject(LtAiPlaceholdersService);

  protected readonly loadError = computed(() => {
    const error = this.placeholders.error();
    return error ? this.feedback.errorText(error) : null;
  });
  protected readonly exampleToken = placeholderToken('name');
  protected readonly token = placeholderToken;

  constructor() {
    void this.placeholders.load();
  }

  protected async copy(name: string): Promise<void> {
    const token = placeholderToken(name);
    const clipboard = this.document.defaultView?.navigator.clipboard;
    try {
      if (!clipboard) {
        throw new Error('clipboard unavailable');
      }
      await clipboard.writeText(token);
      this.feedback.show({ color: 'success', description: `${token} kopiert`, title: 'Platzhalter' });
    } catch {
      this.feedback.invalid('Zwischenablage nicht verfügbar');
    }
  }
}
