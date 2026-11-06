import { DOCUMENT } from '@angular/common';
import { afterNextRender, Component, computed, DestroyRef, inject, Injector, signal } from '@angular/core';
import { LtErrorTranslationService, LtToastService } from '@lenne.tech/ng-base';
import { LtAiConnectionsService, LtAiSettingsService, LtAiStatusService, LtAiUsageService } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmButton, HlmCardImports, HlmProgressImports, HlmSwitch, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCircle, lucideCircleCheck, lucideGauge, lucidePlug, lucideShieldCheck } from '@ng-icons/lucide';

import { formatDateTime, usagePercent } from '../ai/ai-format';

/** Id of the MCP confirmation switch's button (`inputId` and label `for` in the template, focus after a change). */
const MCP_SWITCH_ID = 'ai-mcp-confirmation';

/**
 * `/app/settings/ai` (client-rendered): the user's default AI connection, the MCP confirmation and the token usage.
 *
 * The MCP card shows only while the API runs an MCP server (`GET /ai/status` reports `mcp`); without one the switch
 * would change a setting nothing reads, so the settings are not even loaded. Switched off, MCP clients run destructive
 * tools in the user's name without asking ("bypass permissions", nest-server 12.3.0), so the page warns for as long as
 * it stays off, shows the switch locked while the server enforces the value (`mcpConfirmationEnforced`), offers no
 * switch before the settings are loaded, and always shows what the server holds: a refused change (403 `#LTNS_0609`,
 * an expired session, a 5xx) leaves the setting as it was, and the switch is put back to it.
 */
@Component({
  imports: [HlmBadge, HlmButton, HlmCardImports, HlmProgressImports, HlmSwitch, LtNotice, NgIcon],
  providers: [provideIcons({ lucideCircle, lucideCircleCheck, lucideGauge, lucidePlug, lucideShieldCheck })],
  selector: 'app-ai-settings-page',
  templateUrl: './ai-settings-page.html',
})
export class AiSettingsPage {
  protected readonly connections = inject(LtAiConnectionsService);
  protected readonly settings = inject(LtAiSettingsService);
  protected readonly status = inject(LtAiStatusService);
  protected readonly usage = inject(LtAiUsageService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly document = inject(DOCUMENT);
  private readonly errors = inject(LtErrorTranslationService);
  private readonly injector = inject(Injector);
  private readonly toast = inject(LtToastService);

  /**
   * Re-creates the switch. `hlm-switch` keeps its own checked state and adopts `[checked]` only when that input changes;
   * after a refused change the input stays the same, so the switch would keep showing the value the server refused.
   */
  protected readonly switchGeneration = signal(0);
  protected readonly userUsage = computed(() => this.usage.usage()?.user ?? null);
  protected readonly userTokensPercent = computed(() => {
    const user = this.userUsage();
    return user ? usagePercent(user.usedTokens, user.maxTokens) : 0;
  });
  protected readonly userResetAt = computed(() => formatDateTime(this.userUsage()?.resetAt));

  constructor() {
    afterNextRender(() => void this.load());
  }

  private async load(): Promise<void> {
    await Promise.all([this.connections.load(), this.loadMcpSettings(), this.usage.load()]);
  }

  /** The settings only while the API runs an MCP server (the AI route guard has loaded the status already). */
  private async loadMcpSettings(): Promise<void> {
    await this.status.load();
    if (this.status.mcp()) {
      await this.settings.load();
    }
  }

  protected async choose(id: string): Promise<void> {
    try {
      await this.connections.select(id);
      this.toast.show({ color: 'success', description: 'Standard-Verbindung gespeichert.', title: 'Erfolg' });
      // The pressed "Auswählen" button is gone now (its row shows "Aktiv"): keep the focus in the card.
      this.focusAfterRender('ai-connection-title');
    } catch (error) {
      this.toast.show({ color: 'error', description: this.errors.translateError(error), title: 'Fehler' });
    }
  }

  protected async setMcpConfirmation(value: boolean): Promise<void> {
    const hadFocus = this.document.activeElement?.id === MCP_SWITCH_ID;
    try {
      await this.settings.update({ mcpConfirmation: value });
      this.toast.show({ color: 'success', description: value ? 'MCP-Rückfrage eingeschaltet.' : 'MCP-Rückfrage ausgeschaltet.', title: 'Erfolg' });
    } catch (error) {
      this.toast.show({ color: 'error', description: this.errors.translateError(error), title: 'Fehler' });
    }
    if (this.settings.settings()?.mcpConfirmation !== value) {
      this.switchGeneration.update((generation) => generation + 1);
    }
    // The switch is disabled while the change is saved (and maybe re-created): give it the focus back.
    if (hadFocus) {
      this.focusAfterRender(MCP_SWITCH_ID);
    }
  }

  private focusAfterRender(id: string): void {
    if (this.destroyRef.destroyed) {
      return;
    }
    afterNextRender(() => this.document.getElementById(id)?.focus(), { injector: this.injector });
  }
}
