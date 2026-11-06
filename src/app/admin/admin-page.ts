import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LtAiStatusService } from '@lenne.tech/ng-base/ai';
import { HlmCardImports } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideFilePen, lucideGauge, lucideGraduationCap, lucideListChecks, lucidePlug, lucideScrollText, lucideServerCog } from '@ng-icons/lucide';

import { isAiRoute } from '../ai/ai-routes';

interface AdminCard {
  description: string;
  icon: string;
  link: string;
  title: string;
}

const CARDS: readonly AdminCard[] = [
  { description: 'LLM-Verbindungen verwalten + Fähigkeiten erkennen', icon: 'lucidePlug', link: '/app/admin/ai/connections', title: 'KI-Verbindungen' },
  { description: 'Standard-Verbindung pro Tenant/Nutzer', icon: 'lucideListChecks', link: '/app/admin/ai/preferences', title: 'KI-Präferenzen' },
  { description: 'Token-/Anfrage-Limits', icon: 'lucideGauge', link: '/app/admin/ai/budgets', title: 'KI-Budgets' },
  { description: 'Protokoll der Prompt-Läufe', icon: 'lucideScrollText', link: '/app/admin/ai/interactions', title: 'KI-Audit-Log' },
  { description: 'Prompt-Bausteine bearbeiten', icon: 'lucideFilePen', link: '/app/admin/ai/slots', title: 'KI-Slots' },
  { description: 'Gelernte Hinweise prüfen & freigeben', icon: 'lucideGraduationCap', link: '/app/admin/ai/prompt-hints', title: 'KI-Lern-Hinweise' },
  { description: 'Build-Informationen von App & API (Drift-Erkennung)', icon: 'lucideServerCog', link: '/app/admin/system', title: 'System' },
];

/** `/app/admin`: entry to the admin areas; the AI cards only while the API runs its AI module. */
@Component({
  imports: [HlmCardImports, NgIcon, RouterLink],
  providers: [provideIcons({ lucideFilePen, lucideGauge, lucideGraduationCap, lucideListChecks, lucidePlug, lucideScrollText, lucideServerCog })],
  selector: 'app-admin-page',
  templateUrl: './admin-page.html',
})
export class AdminPage {
  private readonly aiStatus = inject(LtAiStatusService);

  protected readonly cards = computed(() => CARDS.filter((card) => this.aiStatus.enabled() || !isAiRoute(card.link)));

  constructor() {
    void this.aiStatus.load();
  }
}
