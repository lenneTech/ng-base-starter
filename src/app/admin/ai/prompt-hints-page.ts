import { Component, computed, inject, resource, signal } from '@angular/core';
import { form, FormField, FormRoot } from '@angular/forms/signals';
import { type LtAiPromptHint, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import {
  HlmBadge,
  HlmButton,
  HlmCardImports,
  HlmInput,
  HlmSwitch,
  HlmTextarea,
  LtFormField,
  LtNotice,
  LtOverlayService,
  LtPageTitle,
  LtPageTitleActions,
} from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCheck, lucideLoaderCircle, lucidePlus, lucideTrash, lucideX } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { type AiHintStatus, buildManualHintInput, emptyHintForm, HINT_CONTENT_MESSAGE, type HintFormModel, hintStatus, isHintEnabled, partitionHints } from './prompt-hint-model';

/**
 * `/app/admin/ai/prompt-hints` (client-rendered, admin only): review the hints of the governed self-improvement loop.
 * Only approved and enabled hints reach the prompt; hints only ever ADD guidance and can never relax the
 * backend-enforced security core.
 */
@Component({
  imports: [FormField, FormRoot, HlmBadge, HlmButton, HlmCardImports, HlmInput, HlmSwitch, HlmTextarea, LtFormField, LtNotice, LtPageTitle, LtPageTitleActions, NgIcon],
  providers: [provideIcons({ lucideCheck, lucideLoaderCircle, lucidePlus, lucideTrash, lucideX })],
  selector: 'app-prompt-hints-page',
  templateUrl: './prompt-hints-page.html',
})
export class PromptHintsPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly overlay = inject(LtOverlayService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly hints = resource({ loader: () => this.admin.listPromptHints() });
  private readonly partition = computed(() => partitionHints(this.hints.hasValue() ? this.hints.value() : []));
  protected readonly suggested = computed(() => this.partition().suggested);
  protected readonly reviewed = computed(() => this.partition().reviewed);
  protected readonly loadError = computed(() => (this.hints.error() ? this.feedback.errorText(this.hints.error()) : null));

  protected readonly hintStatus = hintStatus;
  protected readonly isHintEnabled = isHintEnabled;
  protected readonly showCreate = signal(false);
  protected readonly saving = signal(false);

  private readonly model = signal<HintFormModel>(emptyHintForm());
  protected readonly hintForm = form(this.model, { submission: { action: async (field) => this.create(field().value()) } });

  protected toggleCreate(): void {
    this.showCreate.update((shown) => !shown);
  }

  protected async setStatus(hint: LtAiPromptHint, status: AiHintStatus): Promise<void> {
    try {
      await this.admin.updatePromptHint(hint.id, { status });
      this.feedback.success(`Hinweis auf „${status}“ gesetzt.`);
      this.hints.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }

  protected async toggleEnabled(hint: LtAiPromptHint): Promise<void> {
    try {
      await this.admin.updatePromptHint(hint.id, { enabled: !isHintEnabled(hint) });
    } catch (error) {
      this.feedback.error(error);
    }
    // Also after a failure: the switch flipped already and has to show the stored state again.
    this.hints.reload();
  }

  protected async remove(hint: LtAiPromptHint): Promise<void> {
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Löschen',
      description: 'Der Hinweis wird endgültig gelöscht.',
      destructive: true,
      title: 'Hinweis löschen?',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.admin.deletePromptHint(hint.id);
      this.feedback.success('Hinweis gelöscht.');
      this.hints.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }

  private async create(value: HintFormModel): Promise<undefined> {
    const input = buildManualHintInput(value);
    if (!input) {
      this.feedback.invalid(HINT_CONTENT_MESSAGE);
      return undefined;
    }
    this.saving.set(true);
    try {
      await this.admin.createPromptHint(input);
      this.feedback.success('Hinweis angelegt und freigegeben.');
      this.model.set(emptyHintForm());
      this.showCreate.set(false);
      this.hints.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.saving.set(false);
    }
    return undefined;
  }
}
