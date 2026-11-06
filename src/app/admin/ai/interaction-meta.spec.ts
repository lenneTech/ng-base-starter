import { interactionMeta } from './interaction-meta';

describe('interactionMeta', () => {
  it('always shows the tokens, 0 when unknown', () => {
    expect(interactionMeta({ id: 'i1' })).toEqual(['0 Tokens']);
  });

  it('adds iterations, actions and the user when present', () => {
    expect(
      interactionMeta({
        actions: [
          { name: 'createUser', success: true },
          { name: 'sendMail', success: false },
        ],
        id: 'i2',
        iterations: 3,
        totalTokens: 1234,
        userId: 'u1',
      }),
    ).toEqual(['1234 Tokens', '3 Iter.', '2 Aktion(en)', 'Nutzer u1']);
  });

  it('leaves out zero iterations and an empty action list', () => {
    expect(interactionMeta({ actions: [], id: 'i3', iterations: 0, totalTokens: 10 })).toEqual(['10 Tokens']);
  });
});
