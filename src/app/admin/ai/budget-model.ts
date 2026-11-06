import type { LtAiBudgetLimit } from '@lenne.tech/ng-base/ai';
import type { LtSelectOption } from '@lenne.tech/ng-base/ui';

import type { AiScope } from './ai-scope';

/** Reset period of a budget limit. */
export type AiBudgetPeriod = NonNullable<LtAiBudgetLimit['period']>;

export const PERIOD_OPTIONS: readonly LtSelectOption<AiBudgetPeriod>[] = [
  { label: 'Tag', value: 'day' },
  { label: 'Monat', value: 'month' },
  { label: 'Ohne Reset', value: 'none' },
];

/** German label of a period; an unknown value is shown as it came. */
export function periodLabel(period: string | undefined): string {
  return PERIOD_OPTIONS.find((option) => option.value === period)?.label ?? period ?? '';
}

/** A limit as the list shows it: 0 or empty means unlimited (∞). */
export function limitValue(value: number | undefined): string {
  return value ? String(value) : '∞';
}

/** The "Neue Limit" form. `null` means empty (unlimited) or nothing picked. */
export interface BudgetFormModel {
  maxPrompts: number | null;
  maxTokens: number | null;
  period: AiBudgetPeriod | null;
  refId: string;
  scope: AiScope | null;
}

export const BUDGET_REF_ID_MESSAGE = 'Bitte eine Referenz-ID (Nutzer-/Tenant-ID) angeben.';

export function emptyBudgetForm(): BudgetFormModel {
  return { maxPrompts: null, maxTokens: null, period: 'day', refId: '', scope: 'user' };
}

/** The request body for `createBudgetLimit`, or `null` while the reference id is missing. Empty limits stay unset. */
export function buildBudgetInput(model: BudgetFormModel): LtAiBudgetLimit | null {
  const refId = model.refId.trim();
  if (!refId) {
    return null;
  }
  return {
    maxPrompts: finiteOrUndefined(model.maxPrompts),
    maxTokens: finiteOrUndefined(model.maxTokens),
    period: model.period ?? 'day',
    refId,
    scope: model.scope ?? 'user',
  };
}

function finiteOrUndefined(value: number | null): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
