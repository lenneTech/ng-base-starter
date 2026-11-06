import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Render mode per route, mirroring the Nuxt template: `/`, `/auth/**` and `/app/**` are
 * server-rendered; the AI pages and `/app/admin/system` render in the browser only (Nuxt `ssr: false`).
 * Nothing is prerendered: every response carries the runtime config of the stage it runs on.
 */
export const serverRoutes: ServerRoute[] = [
  // Client-only, like the Nuxt template's `ssr: false` pages: the AI pages and the build identity.
  { path: 'app/ai', renderMode: RenderMode.Client },
  { path: 'app/settings/ai', renderMode: RenderMode.Client },
  { path: 'app/settings/ai-prompts', renderMode: RenderMode.Client },
  { path: 'app/admin/system', renderMode: RenderMode.Client },
  { path: 'app/admin/ai/**', renderMode: RenderMode.Client },
  { path: '**', renderMode: RenderMode.Server },
];
