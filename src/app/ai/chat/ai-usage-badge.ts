import { Component, computed, input } from '@angular/core';
import type { LtAiBudgetSummary } from '@lenne.tech/ng-base/ai';
import { HlmBadge, HlmTooltip } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCoins } from '@ng-icons/lucide';

import { usageBadgeLabel, usageBadgeTooltip } from './token-budget';

/**
 * Cost of the LAST request (`promptTokens`); the running total of the period belongs to the token bar. The tooltip
 * names the end of the period when one is active. Hidden until a response reported tokens.
 */
@Component({
  imports: [HlmBadge, HlmTooltip, NgIcon],
  providers: [provideIcons({ lucideCoins })],
  selector: 'app-ai-usage-badge',
  templateUrl: './ai-usage-badge.html',
})
export class AiUsageBadge {
  readonly budget = input<LtAiBudgetSummary | null>();

  protected readonly label = computed(() => usageBadgeLabel(this.budget()));
  protected readonly tooltip = computed(() => usageBadgeTooltip(this.budget()));
}
