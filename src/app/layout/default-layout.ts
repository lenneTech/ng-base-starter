import { afterNextRender, Component, computed, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { LtAiStatusService } from '@lenne.tech/ng-base/ai';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import {
  HlmButton,
  HlmSeparator,
  HlmTooltip,
  LtColorModeButton,
  LtFooter,
  LtHeader,
  LtHeaderActions,
  LtHeaderLogo,
  type LtNavigationItem,
  provideLtUiOverlayDefaults,
} from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideClipboardList, lucideCode, lucideLogIn, lucideLogOut, lucideSettings, lucideShield, lucideSparkles } from '@ng-icons/lucide';

import { BRAND_ICONS } from '../shared/brand-icons';
import { SITE_NAME, SITE_REPO_URL } from '../shared/site';

/**
 * Layout of `/` and `/app/**`: header with navigation and account actions, content, footer.
 *
 * The navigation follows the session: AI links only while the API runs its AI module, "Administration" for admins.
 * The AI status is loaded once per app start and only for signed-in users: with the module off (the default) the
 * request answers 404, which the browser would log for every anonymous visitor.
 *
 * `provideLtUiOverlayDefaults()` gives the pages below their own dialog services whose overlays stay out of the
 * browser's top layer, so a toast (e.g. "copied" in the backup-codes dialog) shows above an open dialog. Here and not
 * in `app.config.ts`: the providers reference the UI library, which would otherwise join the initial bundle; here and
 * not on a lazy `loadChildren` route: the routes stay inline, the analytics route resolver reads `router.config`.
 */
@Component({
  imports: [HlmButton, HlmSeparator, HlmTooltip, LtColorModeButton, LtFooter, LtHeader, LtHeaderActions, LtHeaderLogo, NgIcon, RouterLink, RouterOutlet],
  providers: [
    provideIcons({ ...BRAND_ICONS, lucideClipboardList, lucideCode, lucideLogIn, lucideLogOut, lucideSettings, lucideShield, lucideSparkles }),
    provideLtUiOverlayDefaults(),
  ],
  selector: 'app-default-layout',
  templateUrl: './default-layout.html',
})
export class DefaultLayout {
  protected readonly auth = inject(LtAuthService);
  private readonly aiStatus = inject(LtAiStatusService);
  private readonly router = inject(Router);

  protected readonly siteName = SITE_NAME;
  protected readonly githubUrl = SITE_REPO_URL;
  protected readonly year = new Date().getFullYear();

  protected readonly headerItems = computed<LtNavigationItem[]>(() => {
    if (!this.auth.isAuthenticated()) {
      return [];
    }
    const items: LtNavigationItem[] = this.aiStatus.enabled()
      ? [
          { icon: 'lucideSparkles', label: 'KI-Assistent', link: '/app/ai' },
          { icon: 'lucideClipboardList', label: 'KI-Vorlagen', link: '/app/settings/ai-prompts' },
          { icon: 'lucideSettings', label: 'KI-Einstellungen', link: '/app/settings/ai' },
        ]
      : [];
    if (this.auth.isAdmin()) {
      items.push({ icon: 'lucideShield', label: 'Administration', link: '/app/admin' });
    }
    return items;
  });

  constructor() {
    effect(() => {
      if (this.auth.isAuthenticated()) {
        void this.aiStatus.load();
      }
    });
    afterNextRender(() => void this.auth.validateSession());
  }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login');
  }
}
