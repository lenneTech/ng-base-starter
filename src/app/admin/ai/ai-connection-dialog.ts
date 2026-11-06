import { Component, computed, inject, signal } from '@angular/core';
import { form, FormField, FormRoot, hidden, required, validateStandardSchema } from '@angular/forms/signals';
import { type LtAiConnection, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import {
  HlmButton,
  HlmCheckbox,
  HlmDialogFooter,
  HlmDialogHeader,
  HlmDialogTitle,
  HlmInput,
  injectLtOverlayData,
  injectLtOverlayRef,
  LtFormField,
  LtSelect,
} from '@lenne.tech/ng-base/ui';

import { fieldError } from '../../shared/field-error';
import { injectAiAdminFeedback } from './ai-admin-feedback';
import {
  aiConnectionSchema,
  type AiConnectionModel,
  BASE_URL_EXAMPLE,
  BASE_URL_HINT,
  BASE_URL_REQUIRED_MESSAGE,
  buildConnectionInput,
  connectionModel,
  isCliProvider,
  PROVIDER_OPTIONS,
  TRI_STATE_OPTIONS,
} from './ai-connection-model';

/** What the connections page hands to the dialog. */
export interface AiConnectionDialogData {
  /** The connection to edit; omitted to create one. */
  connection?: LtAiConnection;
}

/**
 * Create or edit an AI connection (`LtOverlayService.open`), the counterpart of `ModalAiConnection.vue`. Closes with
 * `true` after a save, so the page reloads its list; dismissing closes with `undefined`, "Abbrechen" with `false`.
 *
 * Capability flags are tri-state ("Automatisch erkennen" leaves them to the backend's probe); the API key is sent
 * only when typed; the base URL is hidden (and skipped by validation) for the Claude Code CLI provider.
 */
@Component({
  imports: [FormField, FormRoot, HlmButton, HlmCheckbox, HlmDialogFooter, HlmDialogHeader, HlmDialogTitle, HlmInput, LtFormField, LtSelect],
  host: { class: 'grid gap-6' },
  selector: 'app-ai-connection-dialog',
  templateUrl: './ai-connection-dialog.html',
})
export class AiConnectionDialog {
  private readonly admin = inject(LtAiAdminService);
  private readonly ref = injectLtOverlayRef<boolean>();
  private readonly feedback = injectAiAdminFeedback();
  private readonly connection = injectLtOverlayData<AiConnectionDialogData | undefined>()?.connection;

  protected readonly isEdit = !!this.connection?.id;
  protected readonly saving = signal(false);
  protected readonly providerOptions = PROVIDER_OPTIONS;
  protected readonly triStateOptions = TRI_STATE_OPTIONS;
  protected readonly baseUrlExample = BASE_URL_EXAMPLE;
  protected readonly baseUrlHint = BASE_URL_HINT;

  private readonly model = signal<AiConnectionModel>(connectionModel(this.connection));
  protected readonly connectionForm = form(
    this.model,
    (path) => {
      required(path.name, { message: 'Name ist erforderlich' });
      required(path.model, { message: 'Modell ist erforderlich' });
      // CLI providers don't use a base URL; a hidden field takes no part in validation.
      hidden(path.baseUrl, ({ valueOf }) => isCliProvider(valueOf(path.providerType)));
      required(path.baseUrl, { message: BASE_URL_REQUIRED_MESSAGE });
      validateStandardSchema(path, aiConnectionSchema);
    },
    { submission: { action: async (field) => this.save(field().value()) } },
  );
  protected readonly fieldError = fieldError;

  protected readonly isCli = computed(() => isCliProvider(this.model().providerType));

  protected cancel(): void {
    this.ref.close(false);
  }

  private async save(value: AiConnectionModel): Promise<undefined> {
    this.saving.set(true);
    try {
      const input = buildConnectionInput(value);
      const id = this.connection?.id;
      if (id) {
        await this.admin.updateConnection(id, input);
      } else {
        await this.admin.createConnection(input);
      }
      this.feedback.success('Verbindung gespeichert.');
      this.ref.close(true);
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.saving.set(false);
    }
    return undefined;
  }
}
