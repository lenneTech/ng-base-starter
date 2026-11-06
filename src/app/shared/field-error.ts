import type { FieldTree } from '@angular/forms/signals';

/**
 * The message to show under a field: its first validation error that carries a message, once the user touched it (or tried to submit, which
 * marks every field touched). Untouched fields stay quiet, so an empty form does not open with a wall of red.
 */
export function fieldError(field: FieldTree<unknown>): string | null {
  const state = field();
  if (!state.touched()) {
    return null;
  }
  return state.errors().find((error) => !!error.message)?.message ?? null;
}
