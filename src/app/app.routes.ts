import { Routes } from '@angular/router';
import { ltAuthGuard, ltRoleGuard, ltSystemSetupGuard } from '@lenne.tech/ng-base/auth/provide';

import { aiRouteGuard } from './ai/ai-route-guard';
import { guestGuard } from './auth/guest-guard';

/**
 * The routes of the Nuxt template, path for path (plan §4 row 28). Pages and the two layout shells are lazy, so the
 * initial bundle holds only the root shell and the router. Every route runs below `ltSystemSetupGuard`, which sends every visit to `/auth/setup` while the API
 * has no admin yet. The guards read the client-writable `lt-auth-state` cookie: they gate the UI, the API authorizes.
 * Render modes per route: `app.routes.server.ts`.
 */
export const routes: Routes = [
  {
    path: '',
    canActivateChild: [ltSystemSetupGuard],
    children: [
      {
        path: 'auth',
        loadComponent: () => import('./layout/slim-layout').then((m) => m.SlimLayout),
        children: [
          {
            path: 'login',
            canActivate: [guestGuard],
            loadComponent: () => import('./auth/login-page').then((m) => m.LoginPage),
            title: 'Anmeldung',
          },
          // Removing this route leaves sign-up open in the API: close it there (README, "No self sign-up?").
          { path: 'register', loadComponent: () => import('./auth/register-page').then((m) => m.RegisterPage), title: 'Registrierung' },
          {
            path: 'forgot-password',
            loadComponent: () => import('./auth/forgot-password-page').then((m) => m.ForgotPasswordPage),
            title: 'Passwort vergessen',
          },
          {
            path: 'reset-password',
            loadComponent: () => import('./auth/reset-password-page').then((m) => m.ResetPasswordPage),
            title: 'Passwort zurücksetzen',
          },
          {
            path: 'verify-email',
            loadComponent: () => import('./auth/verify-email-page').then((m) => m.VerifyEmailPage),
            title: 'E-Mail bestätigen',
          },
          { path: 'setup', loadComponent: () => import('./auth/setup-page').then((m) => m.SetupPage), title: 'Ersteinrichtung' },
          { path: '2fa', loadComponent: () => import('./auth/two-factor-page').then((m) => m.TwoFactorPage), title: 'Zwei-Faktor-Bestätigung' },
        ],
      },
      {
        path: '',
        loadComponent: () => import('./layout/default-layout').then((m) => m.DefaultLayout),
        children: [
          { path: '', loadComponent: () => import('./home/home-page').then((m) => m.HomePage) },
          {
            path: 'app',
            canActivate: [ltAuthGuard],
            canActivateChild: [ltAuthGuard, aiRouteGuard],
            children: [
              { path: '', loadComponent: () => import('./dashboard/dashboard-page').then((m) => m.DashboardPage), title: 'Dashboard' },
              { path: 'settings/security', loadComponent: () => import('./settings/security-page').then((m) => m.SecurityPage), title: 'Sicherheit' },
              { path: 'settings/ai', loadComponent: () => import('./settings/ai-settings-page').then((m) => m.AiSettingsPage), title: 'KI-Einstellungen' },
              { path: 'settings/ai-prompts', loadComponent: () => import('./settings/ai-prompts-page').then((m) => m.AiPromptsPage), title: 'KI-Vorlagen' },
              { path: 'ai', loadComponent: () => import('./ai/ai-page').then((m) => m.AiPage), title: 'KI-Assistent' },
              {
                path: 'admin',
                canActivate: [ltRoleGuard('admin', '/app')],
                canActivateChild: [ltRoleGuard('admin', '/app')],
                children: [
                  { path: '', loadComponent: () => import('./admin/admin-page').then((m) => m.AdminPage), title: 'Administration' },
                  { path: 'system', loadComponent: () => import('./admin/system-page').then((m) => m.SystemPage), title: 'System' },
                  { path: 'ai/connections', loadComponent: () => import('./admin/ai/connections-page').then((m) => m.ConnectionsPage), title: 'KI-Verbindungen' },
                  { path: 'ai/preferences', loadComponent: () => import('./admin/ai/preferences-page').then((m) => m.PreferencesPage), title: 'KI-Verbindungs-Präferenzen' },
                  { path: 'ai/budgets', loadComponent: () => import('./admin/ai/budgets-page').then((m) => m.BudgetsPage), title: 'KI-Budgets' },
                  { path: 'ai/interactions', loadComponent: () => import('./admin/ai/interactions-page').then((m) => m.InteractionsPage), title: 'KI-Audit-Log' },
                  { path: 'ai/slots', loadComponent: () => import('./admin/ai/slots-page').then((m) => m.SlotsPage), title: 'KI-Slots' },
                  { path: 'ai/prompt-hints', loadComponent: () => import('./admin/ai/prompt-hints-page').then((m) => m.PromptHintsPage), title: 'KI-Lern-Hinweise' },
                ],
              },
            ],
          },
          { path: '**', loadComponent: () => import('./error/not-found-page').then((m) => m.NotFoundPage), title: 'Seite nicht gefunden' },
        ],
      },
    ],
  },
];
