import { DatePipe } from '@angular/common';
import { Component, computed, inject, resource } from '@angular/core';
import { LtAiAdminService } from '@lenne.tech/ng-base/ai';
import { HlmButton, HlmCardImports, LtNotice, LtPageTitle, LtPageTitleActions } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucideRefreshCw } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { interactionMeta } from './interaction-meta';

/**
 * `/app/admin/ai/interactions` (client-rendered, admin only): the audit log of prompt runs, read-only. The backend
 * records runs only while `ai.audit` is on.
 */
@Component({
  imports: [DatePipe, HlmButton, HlmCardImports, LtNotice, LtPageTitle, LtPageTitleActions, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucideRefreshCw })],
  selector: 'app-interactions-page',
  templateUrl: './interactions-page.html',
})
export class InteractionsPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly interactions = resource({ loader: () => this.admin.listInteractions() });
  protected readonly list = computed(() => (this.interactions.hasValue() ? this.interactions.value() : []));
  protected readonly loadError = computed(() => (this.interactions.error() ? this.feedback.errorText(this.interactions.error()) : null));
  protected readonly interactionMeta = interactionMeta;

  protected reload(): void {
    this.interactions.reload();
  }
}
