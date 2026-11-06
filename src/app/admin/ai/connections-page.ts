import { Component, computed, inject, resource, signal } from '@angular/core';
import { type LtAiConnection, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmButton, HlmCardImports, HlmTooltip, LtNotice, LtOverlayService, LtPageTitle, LtPageTitleActions } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideKey, lucideLoaderCircle, lucidePencil, lucidePlus, lucideRadar, lucideTrash } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { AiConnectionDialog, type AiConnectionDialogData } from './ai-connection-dialog';
import { capabilityLabel } from './ai-connection-model';

/**
 * `/app/admin/ai/connections` (client-rendered, admin only): the LLM connections with create/edit in a dialog,
 * capability detection and delete. Capabilities left empty are detected automatically by the backend.
 */
@Component({
  imports: [HlmBadge, HlmButton, HlmCardImports, HlmTooltip, LtNotice, LtPageTitle, LtPageTitleActions, NgIcon],
  providers: [provideIcons({ lucideKey, lucideLoaderCircle, lucidePencil, lucidePlus, lucideRadar, lucideTrash })],
  selector: 'app-connections-page',
  templateUrl: './connections-page.html',
})
export class ConnectionsPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly overlay = inject(LtOverlayService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly connections = resource({ loader: () => this.admin.listConnections() });
  protected readonly list = computed(() => (this.connections.hasValue() ? this.connections.value() : []));
  protected readonly loadError = computed(() => (this.connections.error() ? this.feedback.errorText(this.connections.error()) : null));
  /** The row whose detection or deletion is running. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly capabilityLabel = capabilityLabel;

  protected async openDialog(connection?: LtAiConnection): Promise<void> {
    const saved = await this.overlay.open<boolean, AiConnectionDialogData>(AiConnectionDialog, { data: { connection } }).closed;
    if (saved) {
      this.connections.reload();
    }
  }

  protected async detect(connection: LtAiConnection): Promise<void> {
    this.busyId.set(connection.id);
    try {
      const updated = await this.admin.detectCapabilities(connection.id);
      this.feedback.show({
        color: 'success',
        description: `JSON: ${capabilityLabel(updated.supportsJsonResponse)}, Tools: ${capabilityLabel(updated.supportsNativeTools)}`,
        title: 'Fähigkeiten erkannt',
      });
      this.connections.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.busyId.set(null);
    }
  }

  protected async remove(connection: LtAiConnection): Promise<void> {
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Löschen',
      description: `Die Verbindung „${connection.name || connection.id}“ wird endgültig gelöscht.`,
      destructive: true,
      title: 'Verbindung löschen?',
    });
    if (!confirmed) {
      return;
    }
    this.busyId.set(connection.id);
    try {
      await this.admin.deleteConnection(connection.id);
      this.feedback.success('Verbindung gelöscht.');
      this.connections.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.busyId.set(null);
    }
  }
}
