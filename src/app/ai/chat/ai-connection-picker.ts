import { afterNextRender, Component, computed, inject, linkedSignal } from '@angular/core';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAiConnectionsService } from '@lenne.tech/ng-base/ai';
import { HlmTooltip, LtSelect, type LtSelectOption } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLock, lucidePlug } from '@ng-icons/lucide';

/**
 * Self-service choice of the LLM connection in the chat toolbar. Hidden while there is at most one connection; read-only
 * while a mandatory (admin or tenant enforced) layer fixes the choice.
 */
@Component({
  imports: [HlmTooltip, LtSelect, NgIcon],
  providers: [provideIcons({ lucideLock, lucidePlug })],
  selector: 'app-ai-connection-picker',
  templateUrl: './ai-connection-picker.html',
})
export class AiConnectionPicker {
  protected readonly connections = inject(LtAiConnectionsService);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly toast = inject(LtToastService);

  protected readonly options = computed<LtSelectOption<string>[]>(() =>
    this.connections.connections().map((connection) => ({ label: connection.name || connection.id, value: connection.id })),
  );
  /**
   * The value the select shows: the selected connection, and the user's pick while it is being saved. `lt-select` keeps
   * its own value, so a refused pick is put back explicitly (the service's `selected` does not change then).
   */
  protected readonly selectedId = linkedSignal<null | string>(() => this.connections.selected()?.id ?? null);

  constructor() {
    afterNextRender(() => void this.connections.load());
  }

  protected async choose(id: null | string): Promise<void> {
    if (!id || id === this.connections.selected()?.id) {
      return;
    }
    try {
      await this.connections.select(id);
    } catch (error) {
      this.selectedId.set(this.connections.selected()?.id ?? null);
      this.toast.show({ color: 'error', description: this.errors.translateError(error), title: 'Fehler' });
    }
  }
}
