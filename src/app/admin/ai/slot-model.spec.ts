import type { LtAiEffectiveSlot } from '@lenne.tech/ng-base/ai';

import {
  buildSlotInput,
  disabledOverrideInput,
  emptySlotForm,
  isSlotKeyLocked,
  partitionSlots,
  slotFormFromSlot,
  slotFormProblem,
  slotFormTitle,
  slotSaveMode,
} from './slot-model';

const system: LtAiEffectiveSlot = { content: 'Du bist …', enabled: true, isOverride: false, isSystem: true, key: 'base', order: 10 };
const override: LtAiEffectiveSlot = { content: 'Eigener Text', enabled: true, id: 's1', isOverride: true, isSystem: false, key: 'permissions', order: 20 };
const custom: LtAiEffectiveSlot = { capability: 'native', content: 'Extra', enabled: false, id: 's2', isOverride: false, isSystem: false, key: 'extra', locale: 'de', order: 200 };

describe('slot classification', () => {
  it('splits defaults and overrides from custom slots', () => {
    expect(partitionSlots([system, override, custom])).toEqual({ custom: [custom], system: [system, override] });
  });

  it('locks the key of defaults and overrides only', () => {
    expect(isSlotKeyLocked(null)).toBe(false);
    expect(isSlotKeyLocked(system)).toBe(true);
    expect(isSlotKeyLocked(override)).toBe(true);
    expect(isSlotKeyLocked(custom)).toBe(false);
  });

  it('creates a new slot and the first override of a default, updates everything with an id', () => {
    expect(slotSaveMode(null)).toBe('create');
    expect(slotSaveMode(system)).toBe('create');
    expect(slotSaveMode(override)).toBe('update');
    expect(slotSaveMode(custom)).toBe('update');
    expect(slotSaveMode({ ...custom, id: undefined })).toBe('create');
  });

  it('titles the editor by what it edits', () => {
    expect(slotFormTitle(null)).toBe('Neuen eigenen Slot anlegen');
    expect(slotFormTitle(system)).toBe('System-Slot überschreiben: base');
    expect(slotFormTitle(override)).toBe('Override bearbeiten: permissions');
    expect(slotFormTitle(custom)).toBe('Eigenen Slot bearbeiten: extra');
  });
});

describe('slot form', () => {
  it('starts empty, active, for all modes at order 100', () => {
    expect(emptySlotForm()).toEqual({ capability: 'all', content: '', description: '', enabled: true, key: '', locale: '', order: 100 });
  });

  it('prefills from a row with the defaults for missing values', () => {
    expect(slotFormFromSlot(system)).toEqual({ capability: 'all', content: 'Du bist …', description: '', enabled: true, key: 'base', locale: '', order: 10 });
    expect(slotFormFromSlot(custom)).toMatchObject({ capability: 'native', enabled: false, locale: 'de', order: 200 });
  });

  it('needs a key and a content', () => {
    expect(slotFormProblem(emptySlotForm())).toBe('Slot-Key fehlt.');
    expect(slotFormProblem({ ...emptySlotForm(), key: 'extra', content: '  ' })).toBe('Inhalt darf nicht leer sein.');
    expect(slotFormProblem({ ...emptySlotForm(), key: 'extra', content: 'Text' })).toBeNull();
  });

  it('sends an empty locale as undefined and an empty order as unset', () => {
    expect(buildSlotInput({ ...emptySlotForm(), content: 'Text', key: ' extra ', locale: '  ' })).toEqual({
      capability: 'all',
      content: 'Text',
      description: '',
      enabled: true,
      key: 'extra',
      locale: undefined,
      order: 100,
    });
    expect(buildSlotInput({ ...emptySlotForm(), locale: ' de ', order: null })).toMatchObject({ locale: 'de', order: undefined });
  });

  it('hides a default for the tenant with a disabled override', () => {
    expect(disabledOverrideInput(system)).toEqual({ content: 'Du bist …', enabled: false, key: 'base', order: 10 });
  });
});
