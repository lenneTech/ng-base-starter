import { Component, computed, inject, resource, signal } from '@angular/core';
import { form, FormField, FormRoot, hidden } from '@angular/forms/signals';
import { type LtAiConnectionPreference, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmButton, HlmCardImports, HlmCheckbox, HlmInput, LtFormField, LtNotice, LtOverlayService, LtPageTitle, LtSelect } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucidePlus, lucideTrash } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { aiScopeLabel, TENANT_FIRST_SCOPE_OPTIONS } from './ai-scope';
import { buildPreferenceInput, connectionName, connectionOptions, emptyPreferenceForm, PREFERENCE_REQUIRED_MESSAGE, type PreferenceFormModel } from './preference-model';

/**
 * `/app/admin/ai/preferences` (client-rendered, admin only): the default connection per tenant or user; an enforced
 * tenant preference overrides the user's own choice. Saving upserts the row for reference id and scope.
 */
@Component({
  imports: [FormField, FormRoot, HlmBadge, HlmButton, HlmCardImports, HlmCheckbox, HlmInput, LtFormField, LtNotice, LtPageTitle, LtSelect, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucidePlus, lucideTrash })],
  selector: 'app-preferences-page',
  templateUrl: './preferences-page.html',
})
export class PreferencesPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly overlay = inject(LtOverlayService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly preferences = resource({ loader: () => this.admin.listPreferences() });
  protected readonly list = computed(() => (this.preferences.hasValue() ? this.preferences.value() : []));
  protected readonly loadError = computed(() => (this.preferences.error() ? this.feedback.errorText(this.preferences.error()) : null));

  /** Best-effort, only for the picker and the names in the list: a failure leaves the ids. */
  private readonly connections = resource({ loader: () => this.admin.listConnections() });
  private readonly connectionList = computed(() => (this.connections.hasValue() ? this.connections.value() : []));
  protected readonly connectionOptions = computed(() => connectionOptions(this.connectionList()));

  protected readonly scopeOptions = TENANT_FIRST_SCOPE_OPTIONS;
  protected readonly scopeLabel = aiScopeLabel;
  protected readonly saving = signal(false);

  private readonly model = signal<PreferenceFormModel>(emptyPreferenceForm());
  protected readonly preferenceForm = form(
    this.model,
    (path) => {
      // Only a tenant preference can be enforced.
      hidden(path.enforced, ({ valueOf }) => valueOf(path.scope) !== 'tenant');
    },
    { submission: { action: async (field) => this.save(field().value()) } },
  );

  protected connectionName(id: string): string {
    return connectionName(this.connectionList(), id);
  }

  private async save(value: PreferenceFormModel): Promise<undefined> {
    const input = buildPreferenceInput(value);
    if (!input) {
      this.feedback.invalid(PREFERENCE_REQUIRED_MESSAGE);
      return undefined;
    }
    this.saving.set(true);
    try {
      await this.admin.setPreference(input);
      this.feedback.success('Präferenz gespeichert.');
      this.model.update((current) => ({ ...current, refId: '' }));
      this.preferences.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.saving.set(false);
    }
    return undefined;
  }

  protected async remove(preference: LtAiConnectionPreference): Promise<void> {
    const id = preference.id;
    if (!id) {
      return;
    }
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Löschen',
      description: `Die Präferenz für ${aiScopeLabel(preference.scope)} „${preference.refId}“ wird gelöscht.`,
      destructive: true,
      title: 'Präferenz löschen?',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.admin.deletePreference(id);
      this.feedback.success('Präferenz gelöscht.');
      this.preferences.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }
}
