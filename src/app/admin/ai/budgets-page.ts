import { Component, computed, inject, resource, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';
import { type LtAiBudgetLimit, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import { HlmButton, HlmCardImports, HlmInput, LtFormField, LtNotice, LtOverlayService, LtPageTitle, LtSelect } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucidePlus, lucideTrash } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { aiScopeLabel, USER_FIRST_SCOPE_OPTIONS } from './ai-scope';
import { BUDGET_REF_ID_MESSAGE, type BudgetFormModel, buildBudgetInput, emptyBudgetForm, limitValue, PERIOD_OPTIONS, periodLabel } from './budget-model';

/**
 * `/app/admin/ai/budgets` (client-rendered, admin only): token and prompt limits per user or tenant, reset per day,
 * per month or never. 0 or empty means unlimited.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmCardImports, HlmInput, LtFormField, LtNotice, LtPageTitle, LtSelect, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucidePlus, lucideTrash })],
  selector: 'app-budgets-page',
  templateUrl: './budgets-page.html',
})
export class BudgetsPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly overlay = inject(LtOverlayService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly limits = resource({ loader: () => this.admin.listBudgetLimits() });
  protected readonly list = computed(() => (this.limits.hasValue() ? this.limits.value() : []));
  protected readonly loadError = computed(() => (this.limits.error() ? this.feedback.errorText(this.limits.error()) : null));

  protected readonly scopeOptions = USER_FIRST_SCOPE_OPTIONS;
  protected readonly periodOptions = PERIOD_OPTIONS;
  protected readonly scopeLabel = aiScopeLabel;
  protected readonly periodLabel = periodLabel;
  protected readonly limitValue = limitValue;
  protected readonly saving = signal(false);

  private readonly model = signal<BudgetFormModel>(emptyBudgetForm());
  protected readonly budgetForm = form(this.model, { submission: { action: async (field) => this.create(field().value()) } });

  private async create(value: BudgetFormModel): Promise<undefined> {
    const input = buildBudgetInput(value);
    if (!input) {
      this.feedback.invalid(BUDGET_REF_ID_MESSAGE);
      return undefined;
    }
    this.saving.set(true);
    try {
      await this.admin.createBudgetLimit(input);
      this.feedback.success('Budget gespeichert.');
      this.model.update((current) => ({ ...current, maxPrompts: null, maxTokens: null, refId: '' }));
      this.limits.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.saving.set(false);
    }
    return undefined;
  }

  protected async remove(limit: LtAiBudgetLimit): Promise<void> {
    const id = limit.id;
    if (!id) {
      return;
    }
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Löschen',
      description: `Das Limit für ${aiScopeLabel(limit.scope)} „${limit.refId}“ wird gelöscht.`,
      destructive: true,
      title: 'Budget löschen?',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.admin.deleteBudgetLimit(id);
      this.feedback.success('Budget gelöscht.');
      this.limits.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }
}
