import { inject } from '@angular/core';
import { LtErrorTranslationService, type LtToastOptions, LtToastService } from '@lenne.tech/ng-base';

/** Shown when an error carries no message at all (a rejected promise without reason, an empty response body). */
export const AI_ADMIN_ERROR_FALLBACK = 'Ein unerwarteter Fehler ist aufgetreten';

/**
 * The text of a failed admin call: the translated backend message (`#LTNS_xxxx` markers included), or the fallback
 * when there is nothing to translate. The input is tested first, never `translate(x) || 'fallback'`.
 */
export function aiErrorMessage(error: unknown, translate: (error: unknown) => string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return raw.trim() ? translate(error) : AI_ADMIN_ERROR_FALLBACK;
}

/** Feedback of the AI admin pages: toasts with the titles of the Nuxt template ("Erfolg", "Fehler") and error texts. */
export interface AiAdminFeedback {
  /** Error toast for a failed call (translated message). */
  error: (error: unknown) => void;
  /** The translated text of an error, for an inline notice (a list that failed to load). */
  errorText: (error: unknown) => string;
  /** Error toast for an input the page rejects before calling the API. */
  invalid: (description: string) => void;
  /** Any other toast (warning, own title). */
  show: (options: LtToastOptions) => void;
  /** Success toast. */
  success: (description: string) => void;
}

/** Feedback for the AI admin pages; call it in an injection context (field initializer). */
export function injectAiAdminFeedback(): AiAdminFeedback {
  const toast = inject(LtToastService);
  const errors = inject(LtErrorTranslationService);
  const errorText = (error: unknown): string => aiErrorMessage(error, (e) => errors.translateError(e));
  return {
    error: (error) => {
      toast.show({ color: 'error', description: errorText(error), title: 'Fehler' });
    },
    errorText,
    invalid: (description) => {
      toast.show({ color: 'error', description, title: 'Fehler' });
    },
    show: (options) => {
      toast.show(options);
    },
    success: (description) => {
      toast.show({ color: 'success', description, title: 'Erfolg' });
    },
  };
}
