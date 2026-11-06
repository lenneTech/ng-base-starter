/** `{{name}}`, the way a placeholder is written in a prompt (the backend resolves it when the prompt runs). */
export function placeholderToken(name: string): string {
  return `{{${name}}}`;
}
