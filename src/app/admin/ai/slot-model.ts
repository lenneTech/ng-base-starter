import type { LtAiEffectiveSlot, LtAiSlotInput } from '@lenne.tech/ng-base/ai';
import type { LtSelectOption } from '@lenne.tech/ng-base/ui';

/**
 * The slot editor's rules, carried over from the Nuxt template's `slots.vue`. The effective list mixes three kinds of
 * rows, told apart by `isSystem` / `isOverride`:
 *
 * - framework default (`isSystem`, no id): "Bearbeiten" creates a tenant override, "Deaktivieren" creates a disabled
 *   override (soft delete for the tenant);
 * - tenant override (`isOverride`): "Bearbeiten" updates it, "Zurücksetzen" deletes it so the default applies again;
 * - custom tenant slot (neither): "Bearbeiten" updates it, "Löschen" deletes it for good.
 */

export const CAPABILITY_OPTIONS: readonly LtSelectOption[] = [
  { label: 'Alle Modi', value: 'all' },
  { label: 'Native Tools', value: 'native' },
  { label: 'Emulierte Tools', value: 'emulated' },
];

/** The slot editor's form. `null` means an empty number field or nothing picked. */
export interface SlotFormModel {
  capability: string | null;
  content: string;
  description: string;
  enabled: boolean;
  key: string;
  locale: string;
  order: number | null;
}

export function emptySlotForm(): SlotFormModel {
  return { capability: 'all', content: '', description: '', enabled: true, key: '', locale: '', order: 100 };
}

/** The form prefilled from a row of the effective list. */
export function slotFormFromSlot(slot: LtAiEffectiveSlot): SlotFormModel {
  return {
    capability: slot.capability || 'all',
    content: slot.content || '',
    description: slot.description || '',
    enabled: slot.enabled,
    key: slot.key,
    locale: slot.locale || '',
    order: slot.order ?? 100,
  };
}

/** Rows of the "System-Slots" card (defaults and their overrides) and of the "Eigene Slots" card. */
export function partitionSlots(slots: readonly LtAiEffectiveSlot[]): { custom: LtAiEffectiveSlot[]; system: LtAiEffectiveSlot[] } {
  return {
    custom: slots.filter((slot) => !slot.isSystem && !slot.isOverride),
    system: slots.filter((slot) => slot.isSystem || slot.isOverride),
  };
}

/** The key of a default or an override is fixed; only a new or a custom slot takes a key. */
export function isSlotKeyLocked(editing: LtAiEffectiveSlot | null): boolean {
  return !!editing && (editing.isSystem || editing.isOverride);
}

/**
 * `update` for an existing override or custom slot (both have an id); `create` for a new custom slot and for the
 * first override of a framework default.
 */
export function slotSaveMode(editing: LtAiEffectiveSlot | null): 'create' | 'update' {
  return editing?.id && (editing.isOverride || !editing.isSystem) ? 'update' : 'create';
}

/** Heading of the editor card. */
export function slotFormTitle(editing: LtAiEffectiveSlot | null): string {
  if (!editing) {
    return 'Neuen eigenen Slot anlegen';
  }
  if (editing.isSystem) {
    return `System-Slot überschreiben: ${editing.key}`;
  }
  if (editing.isOverride) {
    return `Override bearbeiten: ${editing.key}`;
  }
  return `Eigenen Slot bearbeiten: ${editing.key}`;
}

/** What is wrong with the form before it may be saved, or `null`. */
export function slotFormProblem(model: SlotFormModel): string | null {
  if (!model.key.trim()) {
    return 'Slot-Key fehlt.';
  }
  if (!model.content.trim()) {
    return 'Inhalt darf nicht leer sein.';
  }
  return null;
}

/** The request body for create and update; an empty locale means "all languages". */
export function buildSlotInput(model: SlotFormModel): LtAiSlotInput {
  return {
    capability: model.capability ?? 'all',
    content: model.content,
    description: model.description,
    enabled: model.enabled,
    key: model.key.trim(),
    locale: model.locale.trim() || undefined,
    order: typeof model.order === 'number' && Number.isFinite(model.order) ? model.order : undefined,
  };
}

/** The disabled override that hides a framework default for the tenant ("Deaktivieren"). */
export function disabledOverrideInput(slot: LtAiEffectiveSlot): LtAiSlotInput {
  return { content: slot.content, enabled: false, key: slot.key, order: slot.order };
}
