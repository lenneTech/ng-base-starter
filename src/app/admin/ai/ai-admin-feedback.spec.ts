import { AI_ADMIN_ERROR_FALLBACK, aiErrorMessage } from './ai-admin-feedback';

describe('aiErrorMessage', () => {
  const translate = (error: unknown) => `übersetzt: ${error instanceof Error ? error.message : String(error)}`;

  it('translates an error that carries a message', () => {
    expect(aiErrorMessage(new Error('#LTNS_0400: Bad request'), translate)).toBe('übersetzt: #LTNS_0400: Bad request');
    expect(aiErrorMessage('#LTNS_0403', translate)).toBe('übersetzt: #LTNS_0403');
  });

  it('falls back without calling the translation when there is no message', () => {
    const spy = vi.fn(translate);
    expect(aiErrorMessage(new Error(''), spy)).toBe(AI_ADMIN_ERROR_FALLBACK);
    expect(aiErrorMessage('   ', spy)).toBe(AI_ADMIN_ERROR_FALLBACK);
    expect(aiErrorMessage(undefined, spy)).toBe(AI_ADMIN_ERROR_FALLBACK);
    expect(aiErrorMessage({ status: 500 }, spy)).toBe(AI_ADMIN_ERROR_FALLBACK);
    expect(spy).not.toHaveBeenCalled();
  });
});
