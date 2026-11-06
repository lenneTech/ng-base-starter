import { emptyPromptDraft, PROMPT_SCOPE_OPTIONS, promptDraftError, promptDraftToInput, promptToDraft } from './prompt-draft';

describe('emptyPromptDraft', () => {
  it('starts private, active and with order 100', () => {
    expect(emptyPromptDraft()).toEqual({ content: '', description: '', enabled: true, icon: '', name: '', order: 100, scope: 'user' });
  });

  it('returns a fresh object every time', () => {
    expect(emptyPromptDraft()).not.toBe(emptyPromptDraft());
  });
});

describe('promptToDraft', () => {
  it('copies an existing prompt into the form', () => {
    expect(
      promptToDraft({ content: 'Text', description: 'Wofür', enabled: false, icon: 'i-lucide-mail', id: 'p1', name: 'Mail', order: 5, ownerId: 'u1', scope: 'tenant' }),
    ).toEqual({ content: 'Text', description: 'Wofür', enabled: false, icon: 'i-lucide-mail', name: 'Mail', order: 5, scope: 'tenant' });
  });

  it('fills missing fields with the defaults (enabled unless explicitly false)', () => {
    expect(promptToDraft({ content: 'Text', id: 'p1', name: 'Mail', scope: '' })).toEqual({
      content: 'Text',
      description: '',
      enabled: true,
      icon: '',
      name: 'Mail',
      order: 100,
      scope: 'user',
    });
  });

  it('keeps an order of 0', () => {
    expect(promptToDraft({ content: 'Text', id: 'p1', name: 'Mail', order: 0, scope: 'user' }).order).toBe(0);
  });
});

describe('promptDraftError', () => {
  it('asks for a name first, then for content', () => {
    expect(promptDraftError({ content: '', name: '' })).toBe('Bitte einen Namen angeben.');
    expect(promptDraftError({ content: 'x', name: '   ' })).toBe('Bitte einen Namen angeben.');
    expect(promptDraftError({ content: '  ', name: 'Mail' })).toBe('Bitte einen Inhalt angeben.');
  });

  it('accepts a form with name and content', () => {
    expect(promptDraftError({ content: 'Text', name: 'Mail' })).toBeNull();
  });
});

describe('promptDraftToInput', () => {
  it('sends every field of the form', () => {
    expect(promptDraftToInput({ ...emptyPromptDraft(), content: 'Text', name: 'Mail', order: 7, scope: 'tenant' })).toEqual({
      content: 'Text',
      description: '',
      enabled: true,
      icon: '',
      name: 'Mail',
      order: 7,
      scope: 'tenant',
    });
  });

  it('leaves out an emptied order field instead of sending null', () => {
    expect(promptDraftToInput({ ...emptyPromptDraft(), order: null })).not.toHaveProperty('order');
    expect(promptDraftToInput({ ...emptyPromptDraft(), order: Number.NaN })).not.toHaveProperty('order');
  });
});

describe('PROMPT_SCOPE_OPTIONS', () => {
  it('offers private and tenant visibility', () => {
    expect(PROMPT_SCOPE_OPTIONS).toEqual([
      { label: 'Nur für mich (privat)', value: 'user' },
      { label: 'Mit dem Tenant teilen (öffentlich)', value: 'tenant' },
    ]);
  });
});
