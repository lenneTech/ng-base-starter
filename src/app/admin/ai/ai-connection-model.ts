import type { LtAiConnection, LtAiConnectionInput } from '@lenne.tech/ng-base/ai';
import type { LtSelectOption } from '@lenne.tech/ng-base/ui';
import * as v from 'valibot';

/**
 * The connection dialog's model and the pure rules around it, carried over from the Nuxt template's
 * `ModalAiConnection.vue`.
 *
 * - Capability flags are tri-state: "Automatisch erkennen" leaves them `undefined`, so the backend detects them by
 *   probing the endpoint.
 * - The API key has patch semantics: it is sent only when the admin typed one (empty keeps the stored key on edit).
 * - `claude-cli` drives the local Claude Code CLI and needs no base URL; a stable placeholder satisfies the backend's
 *   required field.
 */

/** Capability flag in the dialog: detect automatically, or force yes/no. */
export type AiTriState = 'auto' | 'no' | 'yes';

export const TRI_STATE_OPTIONS: readonly LtSelectOption<AiTriState>[] = [
  { label: 'Automatisch erkennen', value: 'auto' },
  { label: 'Ja', value: 'yes' },
  { label: 'Nein', value: 'no' },
];

/** Provider type that runs the local Claude Code CLI (register `ClaudeCliProvider` on the backend factory). */
export const CLI_PROVIDER = 'claude-cli';

/** Sent as base URL for CLI connections, which ignore it. */
export const CLI_BASE_URL_PLACEHOLDER = 'cli://claude-code';

/** `openai-compatible` covers hosted (external) and local (e.g. Ollama) endpoints. */
export const PROVIDER_OPTIONS: readonly LtSelectOption[] = [
  { label: 'OpenAI-kompatibel (extern / lokal)', value: 'openai-compatible' },
  { label: 'Claude Code CLI (lokal)', value: CLI_PROVIDER },
];

export const BASE_URL_EXAMPLE = 'https://llm.example.com/v1';
export const BASE_URL_HINT = `OpenAI-kompatibler Endpoint, z.B. ${BASE_URL_EXAMPLE} oder http://localhost:11434/v1 (Ollama)`;
export const BASE_URL_REQUIRED_MESSAGE = 'Basis-URL ist für OpenAI-kompatible Verbindungen erforderlich.';

export function toTriState(value: boolean | undefined): AiTriState {
  return value === undefined ? 'auto' : value ? 'yes' : 'no';
}

export function fromTriState(value: AiTriState | null | undefined): boolean | undefined {
  return !value || value === 'auto' ? undefined : value === 'yes';
}

/** How a capability flag reads in the list and the detection toast. */
export function capabilityLabel(value: boolean | undefined): string {
  return value === undefined ? 'auto' : value ? 'ja' : 'nein';
}

export function isCliProvider(providerType: string | null | undefined): boolean {
  return providerType === CLI_PROVIDER;
}

/** The dialog's form model. */
export interface AiConnectionModel {
  apiKey: string;
  baseUrl: string;
  defaultMaxTokens: number | null;
  isDefault: boolean;
  model: string;
  name: string;
  providerType: string | null;
  supportsJsonResponse: AiTriState | null;
  supportsNativeTools: AiTriState | null;
}

/** The form model for a new connection (no argument) or for editing `connection`; the API key always starts empty. */
export function connectionModel(connection?: LtAiConnection): AiConnectionModel {
  return {
    apiKey: '',
    baseUrl: connection?.baseUrl ?? '',
    defaultMaxTokens: connection?.defaultMaxTokens ?? null,
    isDefault: connection?.isDefault ?? false,
    model: connection?.model ?? '',
    name: connection?.name ?? '',
    providerType: connection?.providerType ?? 'openai-compatible',
    supportsJsonResponse: toTriState(connection?.supportsJsonResponse),
    supportsNativeTools: toTriState(connection?.supportsNativeTools),
  };
}

/** The request body for create and update. */
export function buildConnectionInput(model: AiConnectionModel): LtAiConnectionInput {
  const cli = isCliProvider(model.providerType);
  const input: LtAiConnectionInput = {
    baseUrl: cli ? model.baseUrl || CLI_BASE_URL_PLACEHOLDER : model.baseUrl,
    defaultMaxTokens: typeof model.defaultMaxTokens === 'number' && Number.isFinite(model.defaultMaxTokens) ? model.defaultMaxTokens : undefined,
    isDefault: model.isDefault,
    model: model.model,
    name: model.name,
    providerType: model.providerType ?? 'openai-compatible',
    supportsJsonResponse: fromTriState(model.supportsJsonResponse),
    supportsNativeTools: fromTriState(model.supportsNativeTools),
  };
  // Patch semantics: only send apiKey when the admin typed one.
  if (model.apiKey) {
    input.apiKey = model.apiKey;
  }
  return input;
}

/**
 * Field rules of the dialog. The base URL may be empty (CLI) or must be a valid URL; "required for
 * OpenAI-compatible" is a `required` rule of the form (with {@link BASE_URL_REQUIRED_MESSAGE}), because the field is
 * hidden, and then skipped, for CLI connections.
 */
export const aiConnectionSchema = v.object({
  baseUrl: v.union([v.literal(''), v.pipe(v.string(), v.url('Ungültige URL'))]),
  model: v.pipe(v.string('Modell ist erforderlich'), v.minLength(1, 'Modell ist erforderlich')),
  name: v.pipe(v.string('Name ist erforderlich'), v.minLength(1, 'Name ist erforderlich')),
});
