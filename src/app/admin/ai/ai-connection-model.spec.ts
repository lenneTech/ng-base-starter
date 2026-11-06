import type { LtAiConnection } from '@lenne.tech/ng-base/ai';
import * as v from 'valibot';

import {
  aiConnectionSchema,
  buildConnectionInput,
  capabilityLabel,
  CLI_BASE_URL_PLACEHOLDER,
  connectionModel,
  fromTriState,
  isCliProvider,
  toTriState,
} from './ai-connection-model';

describe('tri-state capability flags', () => {
  it('maps undefined to "auto" and back', () => {
    expect(toTriState(undefined)).toBe('auto');
    expect(toTriState(true)).toBe('yes');
    expect(toTriState(false)).toBe('no');
    expect(fromTriState('auto')).toBeUndefined();
    expect(fromTriState('yes')).toBe(true);
    expect(fromTriState('no')).toBe(false);
    expect(fromTriState(null)).toBeUndefined();
  });

  it('labels a flag for the list', () => {
    expect(capabilityLabel(undefined)).toBe('auto');
    expect(capabilityLabel(true)).toBe('ja');
    expect(capabilityLabel(false)).toBe('nein');
  });
});

describe('connectionModel', () => {
  it('starts a new connection as OpenAI-compatible with automatic detection', () => {
    expect(connectionModel()).toEqual({
      apiKey: '',
      baseUrl: '',
      defaultMaxTokens: null,
      isDefault: false,
      model: '',
      name: '',
      providerType: 'openai-compatible',
      supportsJsonResponse: 'auto',
      supportsNativeTools: 'auto',
    });
  });

  it('prefills an existing connection but never its API key', () => {
    const connection: LtAiConnection = {
      baseUrl: 'https://llm.example.com/v1',
      defaultMaxTokens: 2048,
      hasApiKey: true,
      id: 'c1',
      isDefault: true,
      model: 'gpt-oss-120b',
      name: 'Default LLM',
      providerType: 'openai-compatible',
      supportsJsonResponse: true,
      supportsNativeTools: false,
    };
    expect(connectionModel(connection)).toEqual({
      apiKey: '',
      baseUrl: 'https://llm.example.com/v1',
      defaultMaxTokens: 2048,
      isDefault: true,
      model: 'gpt-oss-120b',
      name: 'Default LLM',
      providerType: 'openai-compatible',
      supportsJsonResponse: 'yes',
      supportsNativeTools: 'no',
    });
  });
});

describe('buildConnectionInput', () => {
  it('sends the API key only when one was typed (patch semantics)', () => {
    const model = { ...connectionModel(), baseUrl: 'https://llm.example.com/v1', model: 'm', name: 'n' };
    expect(buildConnectionInput(model)).not.toHaveProperty('apiKey');
    expect(buildConnectionInput({ ...model, apiKey: 'sk-1' }).apiKey).toBe('sk-1');
  });

  it('leaves auto-detected capabilities and an empty max-token value undefined', () => {
    const input = buildConnectionInput({ ...connectionModel(), baseUrl: 'https://x.test/v1', model: 'm', name: 'n' });
    expect(input.supportsJsonResponse).toBeUndefined();
    expect(input.supportsNativeTools).toBeUndefined();
    expect(input.defaultMaxTokens).toBeUndefined();
    expect(buildConnectionInput({ ...connectionModel(), defaultMaxTokens: Number.NaN }).defaultMaxTokens).toBeUndefined();
    expect(buildConnectionInput({ ...connectionModel(), defaultMaxTokens: 4096, supportsNativeTools: 'yes' })).toMatchObject({
      defaultMaxTokens: 4096,
      supportsNativeTools: true,
    });
  });

  it('sends the placeholder base URL for a CLI connection without one', () => {
    expect(buildConnectionInput({ ...connectionModel(), model: 'sonnet', name: 'CLI', providerType: 'claude-cli' }).baseUrl).toBe(CLI_BASE_URL_PLACEHOLDER);
    expect(buildConnectionInput({ ...connectionModel(), baseUrl: 'cli://own', providerType: 'claude-cli' }).baseUrl).toBe('cli://own');
  });
});

describe('isCliProvider', () => {
  it('recognises the Claude Code CLI provider only', () => {
    expect(isCliProvider('claude-cli')).toBe(true);
    expect(isCliProvider('openai-compatible')).toBe(false);
    expect(isCliProvider(null)).toBe(false);
  });
});

describe('aiConnectionSchema', () => {
  const messages = (input: unknown) => v.safeParse(aiConnectionSchema, input).issues?.map((issue) => issue.message) ?? [];

  it('requires name and model, and accepts an empty or valid base URL', () => {
    expect(messages({ baseUrl: '', model: 'm', name: 'n' })).toEqual([]);
    expect(messages({ baseUrl: 'https://llm.example.com/v1', model: 'm', name: 'n' })).toEqual([]);
    expect(messages({ baseUrl: '', model: '', name: '' })).toEqual(['Modell ist erforderlich', 'Name ist erforderlich']);
  });

  it('rejects a malformed base URL', () => {
    expect(messages({ baseUrl: 'kein url', model: 'm', name: 'n' })).toEqual(['Ungültige URL']);
  });
});
