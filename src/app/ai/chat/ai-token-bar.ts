import { Component, computed, input } from '@angular/core';
import type { LtAiBudgetSummary } from '@lenne.tech/ng-base/ai';
import { HlmPopoverImports, HlmProgressImports } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideCoins, lucideInfo } from '@ng-icons/lucide';

import { formatDateTime, formatTokens } from '../ai-format';
import { budgetScopeDescription, budgetScopeLabel, tokenBarTone, tokenBudgetFigures } from './token-budget';

let nextTokenBarId = 0;

/**
 * Token usage bar: the running usage of the period against the effective limit (green below 50 %, amber from 50 %,
 * red from 85 %). The button opens a popover with the details: where the limit comes from, limit, cumulative usage,
 * remaining, the last request and the reset. Renders nothing while there is no limit of any kind.
 */
@Component({
  imports: [HlmPopoverImports, HlmProgressImports, NgIcon],
  providers: [provideIcons({ lucideCoins, lucideInfo })],
  selector: 'app-ai-token-bar',
  templateUrl: './ai-token-bar.html',
})
export class AiTokenBar {
  readonly budget = input<LtAiBudgetSummary | null>();

  protected readonly summaryId = `ai-token-bar-summary-${++nextTokenBarId}`;
  protected readonly figures = computed(() => tokenBudgetFigures(this.budget()));
  protected readonly visible = computed(() => this.figures().max > 0);
  protected readonly tone = computed(() => tokenBarTone(this.figures().usedPercent));
  protected readonly usedPercentText = computed(() => this.figures().usedPercent.toFixed(1));
  protected readonly isLlmScope = computed(() => this.budget()?.scope === 'llm');
  protected readonly scopeLabel = computed(() => budgetScopeLabel(this.budget()?.scope));
  protected readonly scopeDescription = computed(() => budgetScopeDescription(this.budget()?.scope));
  protected readonly resetAt = computed(() => formatDateTime(this.budget()?.resetAt));
  protected readonly formatTokens = formatTokens;
}
