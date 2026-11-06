import { DOCUMENT } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Injector, signal } from '@angular/core';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { type LtAiPrompt, LtAiPromptsService } from '@lenne.tech/ng-base/ai';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmBadge, HlmButton, HlmCardImports, HlmInput, HlmSwitch, HlmTextarea, HlmTooltip, LtFormField, LtNotice, LtSelect } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucidePencil, lucidePlus, lucideSave, lucideTrash, lucideX } from '@ng-icons/lucide';

import { AiPlaceholderHint } from '../ai/prompts/ai-placeholder-hint';
import { AiPromptIcon } from '../ai/prompts/ai-prompt-icon';
import { placeholderToken } from '../ai/prompts/placeholder-token';
import { type AiPromptDraft, DEFAULT_PROMPT_ORDER, emptyPromptDraft, PROMPT_SCOPE_OPTIONS, promptDraftError, promptDraftToInput, promptToDraft } from '../ai/prompts/prompt-draft';
import { canMutatePrompt, groupPrompts } from '../ai/prompts/prompt-list';
import { isAdminUser } from '../shared/is-admin-user';

/** Text fields of the prompt form bound through `(input)`. */
type AiPromptTextField = 'content' | 'description' | 'icon' | 'name';

/**
 * `/app/settings/ai-prompts` (client-rendered): the user's prompts ("Vorlagen"), short named texts the chat inserts with
 * one click. Lists every prompt the user may see (own private ones, the tenant's shared ones), creates, edits and
 * deletes own prompts and shares them with the tenant (no admin role needed). Admins may edit and delete foreign
 * prompts too. A UI decision only: the server enforces owner-only mutations.
 */
@Component({
  imports: [AiPlaceholderHint, AiPromptIcon, HlmBadge, HlmButton, HlmCardImports, HlmInput, HlmSwitch, HlmTextarea, HlmTooltip, LtFormField, LtNotice, LtSelect, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucidePencil, lucidePlus, lucideSave, lucideTrash, lucideX })],
  selector: 'app-ai-prompts-page',
  templateUrl: './ai-prompts-page.html',
})
export class AiPromptsPage {
  protected readonly prompts = inject(LtAiPromptsService);
  private readonly auth = inject(LtAuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly injector = inject(Injector);
  private readonly toast = inject(LtToastService);

  protected readonly scopeOptions = PROMPT_SCOPE_OPTIONS;
  protected readonly defaultOrder = DEFAULT_PROMPT_ORDER;
  protected readonly exampleToken = placeholderToken('userId');

  protected readonly draft = signal<AiPromptDraft>(emptyPromptDraft());
  /** Id of the prompt in the form; `null` for a new one. */
  protected readonly editId = signal<null | string>(null);
  protected readonly saving = signal(false);

  protected readonly groups = computed(() => groupPrompts(this.prompts.prompts()));
  protected readonly errorText = computed(() => {
    const error = this.prompts.error();
    return error ? this.errors.translateError(error) : null;
  });
  private readonly isAdmin = computed(() => isAdminUser(this.auth.user()));
  private readonly userId = computed(() => this.auth.user()?.id);

  constructor() {
    afterNextRender(() => void this.prompts.load({ includeDisabled: true }));
  }

  protected canMutate(prompt: LtAiPrompt): boolean {
    return canMutatePrompt(prompt, this.userId(), this.isAdmin());
  }

  protected setText(field: AiPromptTextField, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.draft.update((draft) => ({ ...draft, [field]: value }));
  }

  protected setOrder(event: Event): void {
    const input = event.target as HTMLInputElement;
    // A half-typed number ("-", "1e") reads as "": keep the last valid order, or the binding would wipe the field.
    if (input.validity.badInput) {
      return;
    }
    const order = input.value === '' || Number.isNaN(input.valueAsNumber) ? null : input.valueAsNumber;
    this.draft.update((draft) => ({ ...draft, order }));
  }

  protected setScope(scope: null | string): void {
    this.draft.update((draft) => ({ ...draft, scope: scope ?? 'user' }));
  }

  protected setEnabled(enabled: boolean): void {
    this.draft.update((draft) => ({ ...draft, enabled }));
  }

  protected edit(prompt: LtAiPrompt): void {
    this.editId.set(prompt.id);
    this.draft.set(promptToDraft(prompt));
    // The form is above the list: move there, so keyboard and screen reader users land in what they are editing.
    this.focusAfterRender('prompt-name');
  }

  protected cancel(): void {
    this.reset();
    this.focusAfterRender('prompt-name');
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    const invalid = promptDraftError(draft);
    if (invalid) {
      this.toast.show({ color: 'error', description: invalid, title: 'Fehler' });
      return;
    }
    this.saving.set(true);
    try {
      const input = promptDraftToInput(draft);
      const id = this.editId();
      if (id) {
        await this.prompts.update(id, input);
        this.toast.show({ color: 'success', description: 'Vorlage aktualisiert.', title: 'Erfolg' });
      } else {
        await this.prompts.create(input);
        this.toast.show({ color: 'success', description: 'Vorlage angelegt.', title: 'Erfolg' });
      }
      this.reset();
    } catch (error) {
      this.toast.show({ color: 'error', description: this.errors.translateError(error), title: 'Fehler' });
    } finally {
      this.saving.set(false);
    }
  }

  protected async remove(prompt: LtAiPrompt): Promise<void> {
    try {
      await this.prompts.remove(prompt.id);
      this.toast.show({ color: 'success', description: 'Vorlage gelöscht.', title: 'Erfolg' });
      if (this.editId() === prompt.id) {
        this.reset();
      }
      // The row and its buttons are gone: keep the focus in the list.
      this.focusAfterRender('ai-prompts-list-title');
    } catch (error) {
      this.toast.show({ color: 'error', description: this.errors.translateError(error), title: 'Fehler' });
    }
  }

  private reset(): void {
    this.editId.set(null);
    this.draft.set(emptyPromptDraft());
  }

  private focusAfterRender(id: string): void {
    if (this.destroyRef.destroyed) {
      return;
    }
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
