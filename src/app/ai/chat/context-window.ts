import { type AiUsageTone, formatTokens } from '../ai-format';

/** Context-window utilization of the latest assistant turn (`injectLtAiChat().contextWindow`). */
export interface AiContextWindowUsage {
  total: number;
  used: number;
}

/** The ring appears from this share on (Claude Code style: nothing to see while there is plenty of room). */
export const CONTEXT_WINDOW_VISIBLE_FROM = 60;
/** From here the ring turns to the warning colour. */
export const CONTEXT_WINDOW_WARNING_FROM = 75;
/** From here the ring turns to the error colour. */
export const CONTEXT_WINDOW_CRITICAL_FROM = 90;

/** Radius of the ring in its 20×20 view box. */
export const CONTEXT_RING_RADIUS = 8;
/** Length of the ring's stroke: the dash array, and the dash offset of an empty ring. */
export const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

/** Used share of the context window in percent (0–100); 0 without a window or a positive total. */
export function contextWindowPercent(contextWindow: AiContextWindowUsage | null | undefined): number {
  if (!contextWindow || contextWindow.total <= 0) {
    return 0;
  }
  return Math.min(100, (contextWindow.used / contextWindow.total) * 100);
}

/** Whether the ring shows: a window is known and at least {@link CONTEXT_WINDOW_VISIBLE_FROM} % of it is used. */
export function isContextWindowVisible(contextWindow: AiContextWindowUsage | null | undefined): boolean {
  return !!contextWindow && contextWindowPercent(contextWindow) >= CONTEXT_WINDOW_VISIBLE_FROM;
}

/** Colour level of the ring: critical from 90 %, warning from 75 %, normal below. */
export function contextWindowTone(percent: number): AiUsageTone {
  if (percent >= CONTEXT_WINDOW_CRITICAL_FROM) {
    return 'critical';
  }
  if (percent >= CONTEXT_WINDOW_WARNING_FROM) {
    return 'warning';
  }
  return 'normal';
}

/** `stroke-dashoffset` of the progress arc: the full circumference for 0 %, 0 for a closed ring at 100 %. */
export function contextWindowDashOffset(percent: number): number {
  return CONTEXT_RING_CIRCUMFERENCE * (1 - percent / 100);
}

/** The two tooltip lines: exact share and the token counts. */
export function contextWindowTooltipLines(contextWindow: AiContextWindowUsage): [string, string] {
  const percent = contextWindowPercent(contextWindow);
  return [`Kontextfenster: ${percent.toFixed(1)}% genutzt`, `Verbraucht: ${formatTokens(contextWindow.used)} / ${formatTokens(contextWindow.total)} Tokens`];
}

/** Accessible name of the ring. */
export function contextWindowAriaLabel(percent: number): string {
  return `Kontextfenster ${percent.toFixed(0)}% genutzt`;
}
