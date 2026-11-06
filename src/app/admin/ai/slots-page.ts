import { Component, computed, type ElementRef, inject, resource, signal, viewChild } from '@angular/core';
import { disabled, form, FormField, FormRoot } from '@angular/forms/signals';
import { type LtAiEffectiveSlot, LtAiAdminService } from '@lenne.tech/ng-base/ai';
import {
  HlmBadge,
  HlmButton,
  HlmCardImports,
  HlmInput,
  HlmSwitch,
  HlmTextarea,
  HlmTooltip,
  LtFormField,
  LtNotice,
  LtOverlayService,
  LtPageTitle,
  LtSelect,
} from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideEyeOff, lucideLoaderCircle, lucidePencil, lucidePlus, lucideRotateCcw, lucideSave, lucideTrash, lucideX } from '@ng-icons/lucide';

import { injectAiAdminFeedback } from './ai-admin-feedback';
import { PlaceholderHint } from './placeholder-hint';
import {
  buildSlotInput,
  CAPABILITY_OPTIONS,
  disabledOverrideInput,
  emptySlotForm,
  isSlotKeyLocked,
  partitionSlots,
  slotFormFromSlot,
  slotFormProblem,
  slotFormTitle,
  type SlotFormModel,
  slotSaveMode,
} from './slot-model';

/**
 * `/app/admin/ai/slots` (client-rendered, admin only): tenant-scoped overrides of the system-prompt building blocks.
 * Framework defaults appear as virtual rows; "Bearbeiten" creates an override, "Zurücksetzen" deletes it,
 * "Deaktivieren" on a system slot soft-deletes it for the tenant (disabled override). "Löschen" on a custom tenant
 * slot is a real, non-recoverable delete. The sidebar lists the placeholders the backend supports.
 */
@Component({
  imports: [
    FormField,
    FormRoot,
    HlmBadge,
    HlmButton,
    HlmCardImports,
    HlmInput,
    HlmSwitch,
    HlmTextarea,
    HlmTooltip,
    LtFormField,
    LtNotice,
    LtPageTitle,
    LtSelect,
    NgIcon,
    PlaceholderHint,
  ],
  providers: [provideIcons({ lucideEyeOff, lucideLoaderCircle, lucidePencil, lucidePlus, lucideRotateCcw, lucideSave, lucideTrash, lucideX })],
  selector: 'app-slots-page',
  templateUrl: './slots-page.html',
})
export class SlotsPage {
  private readonly admin = inject(LtAiAdminService);
  private readonly overlay = inject(LtOverlayService);
  private readonly feedback = injectAiAdminFeedback();

  protected readonly slots = resource({ loader: () => this.admin.listEffectiveSlots() });
  private readonly partition = computed(() => partitionSlots(this.slots.hasValue() ? this.slots.value() : []));
  protected readonly systemSlots = computed(() => this.partition().system);
  protected readonly customSlots = computed(() => this.partition().custom);
  protected readonly loadError = computed(() => (this.slots.error() ? this.feedback.errorText(this.slots.error()) : null));

  protected readonly capabilityOptions = CAPABILITY_OPTIONS;
  protected readonly saving = signal(false);
  /** The row in the editor; `null` while a new custom slot is being written. */
  protected readonly editing = signal<LtAiEffectiveSlot | null>(null);
  protected readonly formTitle = computed(() => slotFormTitle(this.editing()));
  private readonly formHeading = viewChild.required<ElementRef<HTMLElement>>('formHeading');

  private readonly model = signal<SlotFormModel>(emptySlotForm());
  protected readonly slotForm = form(
    this.model,
    (path) => {
      // The key of a default or an override is fixed.
      disabled(path.key, () => isSlotKeyLocked(this.editing()));
    },
    { submission: { action: async (field) => this.save(field().value()) } },
  );

  protected startNew(): void {
    this.editing.set(null);
    this.model.set(emptySlotForm());
  }

  protected startEdit(slot: LtAiEffectiveSlot): void {
    this.editing.set(slot);
    this.model.set(slotFormFromSlot(slot));
    // The editor sits above the lists: take keyboard and screen-reader users along.
    this.formHeading().nativeElement.focus();
  }

  private async save(value: SlotFormModel): Promise<undefined> {
    const problem = slotFormProblem(value);
    if (problem) {
      this.feedback.invalid(problem);
      return undefined;
    }
    this.saving.set(true);
    try {
      const editing = this.editing();
      const payload = buildSlotInput(value);
      if (slotSaveMode(editing) === 'update' && editing?.id) {
        // Update an existing override or custom slot.
        await this.admin.updateSlot(editing.id, payload);
        this.feedback.success('Slot aktualisiert.');
      } else {
        // Either: overriding a system default for the first time, OR creating a new custom slot.
        await this.admin.createSlot(payload);
        this.feedback.success(editing?.isSystem ? 'Override angelegt.' : 'Slot angelegt.');
      }
      this.startNew();
      this.slots.reload();
    } catch (error) {
      this.feedback.error(error);
    } finally {
      this.saving.set(false);
    }
    return undefined;
  }

  protected async reset(slot: LtAiEffectiveSlot): Promise<void> {
    const id = slot.id;
    if (!id) {
      return;
    }
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Zurücksetzen',
      description: `Der Tenant-Override für „${slot.key}“ wird gelöscht; danach gilt wieder der System-Standard.`,
      destructive: true,
      title: 'Override zurücksetzen?',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.admin.resetSlot(id);
      this.feedback.success('Auf System-Standard zurückgesetzt.');
      if (this.editing()?.id === id) {
        this.startNew();
      }
      this.slots.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }

  protected async remove(slot: LtAiEffectiveSlot): Promise<void> {
    const id = slot.id;
    if (!id) {
      return;
    }
    const confirmed = await this.overlay.confirm({
      cancelLabel: 'Abbrechen',
      confirmLabel: 'Löschen',
      description: `Der eigene Slot „${slot.key}“ wird endgültig gelöscht und kann nicht wiederhergestellt werden.`,
      destructive: true,
      title: 'Slot löschen?',
    });
    if (!confirmed) {
      return;
    }
    try {
      await this.admin.deleteSlot(id);
      this.feedback.success('Slot gelöscht.');
      if (this.editing()?.id === id) {
        this.startNew();
      }
      this.slots.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }

  /** System default → create a disabled override (hides it for this tenant; "Zurücksetzen" brings it back). */
  protected async softDeleteSystem(slot: LtAiEffectiveSlot): Promise<void> {
    try {
      await this.admin.createSlot(disabledOverrideInput(slot));
      this.feedback.show({ color: 'warning', description: `„${slot.key}“ ist für diesen Tenant deaktiviert.`, title: 'Deaktiviert' });
      this.slots.reload();
    } catch (error) {
      this.feedback.error(error);
    }
  }
}
