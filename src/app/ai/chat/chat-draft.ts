/**
 * Insert a prompt ("Vorlage") into the chat draft: appended, never replacing what the user already typed, on a new
 * line unless the draft already ends with whitespace. The user can still edit the result before sending.
 */
export function appendPromptToDraft(draft: string, content: string): string {
  const separator = draft && !/\s$/.test(draft) ? '\n' : '';
  return `${draft}${separator}${content}`;
}
