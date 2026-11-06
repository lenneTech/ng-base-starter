import type { LtAiPrompt } from '@lenne.tech/ng-base/ai';

import { canMutatePrompt, groupPrompts } from './prompt-list';

function prompt(id: string, scope: string, ownerId?: string): LtAiPrompt {
  return { content: `Inhalt ${id}`, id, name: `Vorlage ${id}`, ownerId, scope };
}

describe('groupPrompts', () => {
  it('puts own prompts before shared ones, keeping the server order inside a group', () => {
    const groups = groupPrompts([prompt('t1', 'tenant'), prompt('u1', 'user'), prompt('t2', 'tenant'), prompt('u2', 'user')]);

    expect(groups.map((group) => group.key)).toEqual(['user', 'tenant']);
    expect(groups.map((group) => group.label)).toEqual(['Eigene (privat)', 'Geteilt (Tenant)']);
    expect(groups[0]?.prompts.map((item) => item.id)).toEqual(['u1', 'u2']);
    expect(groups[1]?.prompts.map((item) => item.id)).toEqual(['t1', 't2']);
  });

  it('leaves empty groups out', () => {
    expect(groupPrompts([prompt('t1', 'tenant')]).map((group) => group.key)).toEqual(['tenant']);
    expect(groupPrompts([])).toEqual([]);
  });

  it('shows prompts of another scope in neither group', () => {
    expect(groupPrompts([prompt('g1', 'global')])).toEqual([]);
  });
});

describe('canMutatePrompt', () => {
  it('lets the owner edit their prompt', () => {
    expect(canMutatePrompt(prompt('u1', 'user', 'me'), 'me', false)).toBe(true);
  });

  it('keeps others away from a foreign prompt', () => {
    expect(canMutatePrompt(prompt('t1', 'tenant', 'someone-else'), 'me', false)).toBe(false);
  });

  it('lets admins edit foreign prompts', () => {
    expect(canMutatePrompt(prompt('t1', 'tenant', 'someone-else'), 'me', true)).toBe(true);
    expect(canMutatePrompt(prompt('t2', 'tenant'), undefined, true)).toBe(true);
  });

  it('counts nothing as own while the user id is unknown', () => {
    expect(canMutatePrompt(prompt('t1', 'tenant'), undefined, false)).toBe(false);
    expect(canMutatePrompt(prompt('t2', 'tenant', 'someone'), undefined, false)).toBe(false);
  });
});
