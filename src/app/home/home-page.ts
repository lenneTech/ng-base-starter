import { Component, inject } from '@angular/core';
import { Meta } from '@angular/platform-browser';
import { HlmAlert, HlmAlertDescription, HlmAlertTitle, HlmBadge, HlmButton, HlmCardImports } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideArrowRight, lucideCircleCheck, lucideDatabase, lucideInfo, lucidePalette, lucideRocket } from '@ng-icons/lucide';

import { BRAND_ICONS } from '../shared/brand-icons';
import { SITE_DESCRIPTION } from '../shared/site';

/** A feature card of the landing page. */
interface Feature {
  color: 'info' | 'primary' | 'secondary' | 'success';
  description: string;
  icon: string;
  title: string;
}

/**
 * `/`: the public landing page and the only indexable route (`/app`, `/auth` and `/admin` are noindex), so its head is
 * what search results and link previews show for the whole project. The hero subtitle IS the meta description, so the
 * two cannot drift apart; og:description follows it.
 */
@Component({
  imports: [HlmAlert, HlmAlertDescription, HlmAlertTitle, HlmBadge, HlmButton, HlmCardImports, NgIcon],
  providers: [provideIcons({ lucideArrowRight, lucideCircleCheck, lucideDatabase, lucideInfo, lucidePalette, lucideRocket, simpleGithub: BRAND_ICONS.simpleGithub })],
  selector: 'app-home-page',
  templateUrl: './home-page.html',
})
export class HomePage {
  protected readonly description = SITE_DESCRIPTION;

  protected readonly links = {
    angular: 'https://angular.dev',
    github: 'https://github.com/lenneTech/ng-base-starter',
    spartan: 'https://www.spartan.ng',
  };

  protected readonly features: readonly Feature[] = [
    { color: 'primary', description: 'Built with Angular 22: signals, zoneless change detection, SSR and TypeScript.', icon: 'lucideRocket', title: 'Modern Stack' },
    { color: 'secondary', description: 'Spartan UI components from @lenne.tech/ng-base, Tailwind CSS v4 and a themeable palette.', icon: 'lucidePalette', title: 'UI Components' },
    { color: 'success', description: 'REST API integration with types and resources generated from the OpenAPI schema.', icon: 'lucideDatabase', title: 'API Ready' },
    { color: 'info', description: 'Signal Forms with Valibot, Better Auth with 2FA and passkeys, Docker and CI included.', icon: 'lucideCircleCheck', title: 'Production Ready' },
  ];

  /** Tailwind classes per feature color (literal strings, so the class scanner finds them). */
  protected readonly iconClasses: Record<Feature['color'], string> = {
    info: 'bg-info/10 text-info',
    primary: 'bg-primary/10 text-primary',
    secondary: 'bg-secondary/10 text-secondary',
    success: 'bg-success/10 text-success',
  };

  constructor() {
    const meta = inject(Meta);
    meta.updateTag({ content: this.description, name: 'description' });
    meta.updateTag({ content: this.description, property: 'og:description' });
  }
}
