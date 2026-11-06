import type { LtAiConnection } from '@lenne.tech/ng-base/ai';

import { buildPreferenceInput, connectionName, connectionOptions, emptyPreferenceForm } from './preference-model';

describe('buildPreferenceInput', () => {
  it('needs a reference id and a connection', () => {
    expect(buildPreferenceInput(emptyPreferenceForm())).toBeNull();
    expect(buildPreferenceInput({ ...emptyPreferenceForm(), refId: '   ', connectionId: 'c1' })).toBeNull();
    expect(buildPreferenceInput({ ...emptyPreferenceForm(), refId: 't1' })).toBeNull();
  });

  it('keeps "enforced" for a tenant and drops it for a user', () => {
    expect(buildPreferenceInput({ connectionId: 'c1', enforced: true, refId: ' t1 ', scope: 'tenant' })).toEqual({
      connectionId: 'c1',
      enforced: true,
      refId: 't1',
      scope: 'tenant',
    });
    expect(buildPreferenceInput({ connectionId: 'c1', enforced: true, refId: 'u1', scope: 'user' })).toEqual({
      connectionId: 'c1',
      enforced: false,
      refId: 'u1',
      scope: 'user',
    });
  });

  it('starts with the tenant scope and nothing picked', () => {
    expect(emptyPreferenceForm()).toEqual({ connectionId: null, enforced: false, refId: '', scope: 'tenant' });
  });
});

describe('connection names', () => {
  const connections: LtAiConnection[] = [
    { id: 'c1', name: 'Default LLM' },
    { id: 'c2', name: '' },
  ];

  it('labels the picker with the name, or the id when there is none', () => {
    expect(connectionOptions(connections)).toEqual([
      { label: 'Default LLM', value: 'c1' },
      { label: 'c2', value: 'c2' },
    ]);
  });

  it('resolves a preference target, falling back to the id', () => {
    expect(connectionName(connections, 'c1')).toBe('Default LLM');
    expect(connectionName(connections, 'c2')).toBe('c2');
    expect(connectionName(connections, 'gone')).toBe('gone');
  });
});
