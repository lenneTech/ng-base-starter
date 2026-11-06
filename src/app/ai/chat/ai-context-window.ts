import { Component, computed, input } from '@angular/core';
import { HlmTooltip } from '@lenne.tech/ng-base/ui';

import type { AiUsageTone } from '../ai-format';
import {
  type AiContextWindowUsage,
  CONTEXT_RING_CIRCUMFERENCE,
  CONTEXT_RING_RADIUS,
  contextWindowAriaLabel,
  contextWindowDashOffset,
  contextWindowPercent,
  contextWindowTone,
  contextWindowTooltipLines,
  isContextWindowVisible,
} from './context-window';

const RING_CLASSES: Record<AiUsageTone, string> = {
  critical: 'text-destructive',
  normal: 'text-primary',
  warning: 'text-warning',
};

/**
 * Context-window indicator: a ring that closes as the conversation fills the model's context window (Claude Code
 * style). Shown from 60 % on, warning colour from 75 %, error colour from 90 %; the tooltip (hover or keyboard focus)
 * gives the exact share and the token counts.
 */
@Component({
  imports: [HlmTooltip],
  selector: 'app-ai-context-window',
  templateUrl: './ai-context-window.html',
})
export class AiContextWindow {
  readonly contextWindow = input<AiContextWindowUsage | null>();

  protected readonly radius = CONTEXT_RING_RADIUS;
  protected readonly circumference = CONTEXT_RING_CIRCUMFERENCE;
  protected readonly percent = computed(() => contextWindowPercent(this.contextWindow()));
  protected readonly visible = computed(() => isContextWindowVisible(this.contextWindow()));
  protected readonly dashOffset = computed(() => contextWindowDashOffset(this.percent()));
  protected readonly ringClass = computed(() => RING_CLASSES[contextWindowTone(this.percent())]);
  protected readonly ariaLabel = computed(() => contextWindowAriaLabel(this.percent()));
  protected readonly tooltipLines = computed(() => {
    const contextWindow = this.contextWindow();
    return contextWindow ? contextWindowTooltipLines(contextWindow) : [];
  });
}
