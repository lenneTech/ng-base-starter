/** The token a placeholder is written as in a slot or prompt (`roles` → `{{roles}}`). */
export function placeholderToken(name: string): string {
  return `{{${name}}}`;
}
