import type { LtAiConnection, LtAiConnectionPreference } from '@lenne.tech/ng-base/ai';
import type { LtSelectOption } from '@lenne.tech/ng-base/ui';

import type { AiScope } from './ai-scope';

/** The "Neue Präferenz" form. `null` means nothing picked yet. */
export interface PreferenceFormModel {
  connectionId: string | null;
  enforced: boolean;
  refId: string;
  scope: AiScope | null;
}

export const PREFERENCE_REQUIRED_MESSAGE = 'Referenz-ID und Verbindung sind erforderlich.';

export function emptyPreferenceForm(): PreferenceFormModel {
  return { connectionId: null, enforced: false, refId: '', scope: 'tenant' };
}

/**
 * The request body for `setPreference`, or `null` while reference id or connection is missing. Only a tenant
 * preference can be enforced (it then overrides the user's choice).
 */
export function buildPreferenceInput(model: PreferenceFormModel): LtAiConnectionPreference | null {
  const refId = model.refId.trim();
  if (!refId || !model.connectionId) {
    return null;
  }
  const scope = model.scope ?? 'tenant';
  return { connectionId: model.connectionId, enforced: scope === 'tenant' ? model.enforced : false, refId, scope };
}

/** The connection picker's options (name, or the id when a connection has none). */
export function connectionOptions(connections: readonly LtAiConnection[]): LtSelectOption[] {
  return connections.map((connection) => ({ label: connection.name || connection.id, value: connection.id }));
}

/** The name of the connection a preference points to, or its id when the connection is unknown or unnamed. */
export function connectionName(connections: readonly LtAiConnection[], id: string): string {
  return connections.find((connection) => connection.id === id)?.name || id;
}
