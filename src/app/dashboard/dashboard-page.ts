import { Component, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LtAuthService } from '@lenne.tech/ng-base/auth';
import { HlmBadge, HlmButton, HlmCardImports } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLogOut, lucideShieldCheck, lucideUser } from '@ng-icons/lucide';

import { injectSocialSignInMarks } from '../auth/social-sign-in-marks';

/** A quick-access card of the dashboard. */
interface QuickAccess {
  description: string;
  icon: string;
  link: string;
  title: string;
}

/** `/app`: welcome, quick access and the signed-in account. */
@Component({
  imports: [HlmBadge, HlmButton, HlmCardImports, NgIcon, RouterLink],
  providers: [provideIcons({ lucideLogOut, lucideShieldCheck, lucideUser })],
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.html',
})
export class DashboardPage {
  protected readonly auth = inject(LtAuthService);
  private readonly marks = injectSocialSignInMarks();
  private readonly router = inject(Router);

  protected readonly pages: readonly QuickAccess[] = [
    { description: 'Verwalte 2FA, Passkeys und Kontosicherheit', icon: 'lucideShieldCheck', link: '/app/settings/security', title: 'Sicherheit' },
  ];

  protected async signOut(): Promise<void> {
    // Keeps the login page, in this tab and every other of this browser, from signing the visitor straight back in
    // through the provider session, which outlives the app's (`auth/social-sign-in-marks.ts`).
    this.marks.markSignedOut();
    await this.auth.signOut();
    await this.router.navigateByUrl('/auth/login');
  }
}
