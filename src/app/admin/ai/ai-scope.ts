import type { LtSelectOption } from '@lenne.tech/ng-base/ui';

/** Who a preference or a budget limit applies to. */
export type AiScope = 'tenant' | 'user';

/** German label of a scope ("Nutzer" for `user`, "Tenant" otherwise, as in the Nuxt template). */
export function aiScopeLabel(scope: string | undefined): string {
  return scope === 'user' ? 'Nutzer' : 'Tenant';
}

/** Scope options with the user first (budgets). */
export const USER_FIRST_SCOPE_OPTIONS: readonly LtSelectOption<AiScope>[] = [
  { label: 'Nutzer', value: 'user' },
  { label: 'Tenant', value: 'tenant' },
];

/** Scope options with the tenant first (connection preferences). */
export const TENANT_FIRST_SCOPE_OPTIONS: readonly LtSelectOption<AiScope>[] = [
  { label: 'Tenant', value: 'tenant' },
  { label: 'Nutzer', value: 'user' },
];
