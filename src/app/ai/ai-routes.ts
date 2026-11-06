/**
 * Routes that exist only while the API runs its AI module (nest-server `GET /ai/status`, 404 when
 * off): the assistant, the user's AI settings and prompts, and the AI admin pages.
 * `ai.global.ts` sends them to /app while the module is off; the layout and the admin dashboard
 * hide their links.
 */
const AI_ROUTE = /^\/app\/(?:ai|settings\/ai|settings\/ai-prompts|admin\/ai)(?:\/|$)/;

export function isAiRoute(path: string): boolean {
  return AI_ROUTE.test(path);
}
