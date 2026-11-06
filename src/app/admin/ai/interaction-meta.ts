import type { LtAiInteraction } from '@lenne.tech/ng-base/ai';

/**
 * The facts under an audit-log entry, in the order of the Nuxt template: tokens (always), iterations, actions and the
 * user (each only when present).
 */
export function interactionMeta(interaction: LtAiInteraction): string[] {
  const meta = [`${interaction.totalTokens ?? 0} Tokens`];
  if (interaction.iterations) {
    meta.push(`${interaction.iterations} Iter.`);
  }
  if (interaction.actions?.length) {
    meta.push(`${interaction.actions.length} Aktion(en)`);
  }
  if (interaction.userId) {
    meta.push(`Nutzer ${interaction.userId}`);
  }
  return meta;
}
