import { aiScopeLabel, TENANT_FIRST_SCOPE_OPTIONS, USER_FIRST_SCOPE_OPTIONS } from './ai-scope';

describe('aiScopeLabel', () => {
  it('names the user scope and treats everything else as tenant', () => {
    expect(aiScopeLabel('user')).toBe('Nutzer');
    expect(aiScopeLabel('tenant')).toBe('Tenant');
    expect(aiScopeLabel(undefined)).toBe('Tenant');
  });
});

describe('scope options', () => {
  it('lists both scopes in the order of the Nuxt pages', () => {
    expect(USER_FIRST_SCOPE_OPTIONS.map((option) => option.value)).toEqual(['user', 'tenant']);
    expect(TENANT_FIRST_SCOPE_OPTIONS.map((option) => option.value)).toEqual(['tenant', 'user']);
  });
});
