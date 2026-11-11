import { httpResource } from '@angular/common/http';
import { afterNextRender, Component, computed, type ElementRef, effect, inject, Injector, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { LtApiUrlService } from '@lenne.tech/ng-base';
import { HlmBadge, HlmButton, HlmCardImports, HlmSeparator, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle, lucideRefreshCw } from '@ng-icons/lucide';

import { buildsMatch, shortCommit } from './build-drift';

/** `GET <api>/meta` of nest-server. */
interface ApiMeta {
  commit: string;
  environment: string;
  version: string;
}

/** `GET /api/build-identity` of this app's own server (src/server.ts). */
interface BuildIdentity {
  commit: string;
  version: string;
}

const API_FAILED = 'Die API hat ihren Build-Stand nicht gemeldet. Ohne ihn lässt sich nicht prüfen, ob App und API zusammenpassen.';

/**
 * `/app/admin/system` (client-rendered): the running app and API build side by side, so a stale container after a
 * partial rollout shows at a glance. The app's commit comes from its own server (`/api/build-identity`), which can
 * read the prefix-free `APP_VERSION_COMMIT` a platform never blanks.
 *
 * A failed `GET <api>/meta` is an error with "Erneut versuchen", never a silent "unbekannt": without the API's answer
 * there is nothing to compare, and an outage must not look like a local build (found in a project, DEV-4180; as in the
 * Nuxt template). The alert, and the focused retry button with it, stays mounted while a retry runs; a retry that fails
 * again says so with the time, one that succeeds moves the focus to the API heading (system-page.spec.ts).
 */
@Component({
  imports: [HlmBadge, HlmButton, HlmCardImports, HlmSeparator, LtNotice, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle, lucideRefreshCw })],
  selector: 'app-system-page',
  templateUrl: './system-page.html',
})
export class SystemPage {
  private readonly api = inject(LtApiUrlService);
  private readonly injector = inject(Injector);
  private readonly apiHeading = viewChild<ElementRef<HTMLElement>>('apiHeading');

  protected readonly apiMeta = httpResource<ApiMeta>(() => this.api.buildUrl('/meta'));
  protected readonly appIdentity = httpResource<BuildIdentity>(() => '/api/build-identity');

  /** Set by an error, cleared only by an answer: a running retry keeps the alert (and the focused button) mounted. */
  protected readonly apiFailed = linkedSignal<string, boolean>({
    source: () => this.apiMeta.status(),
    computation: (status, previous) => (status === 'error' ? true : status === 'resolved' || status === 'local' ? false : (previous?.value ?? false)),
  });
  /** A retry the user started is in flight. */
  private readonly retrying = signal(false);
  /** Local time of the last retry that failed as well, `''` when there was none. */
  protected readonly retryFailedAt = signal('');

  protected readonly apiFailedDescription = computed(() =>
    this.retryFailedAt() ? `${API_FAILED} Letzter Versuch um ${this.retryFailedAt()} Uhr: weiterhin keine Antwort.` : API_FAILED,
  );
  /** Read out by the live region: in an outage the answer comes back at once, and the page would look unchanged. */
  protected readonly retryStatus = computed(() => {
    if (this.retrying()) {
      return 'Wird erneut abgefragt …';
    }
    return this.retryFailedAt() ? `Erneuter Versuch um ${this.retryFailedAt()} Uhr fehlgeschlagen.` : '';
  });

  protected readonly appVersion = computed(() => (this.appIdentity.hasValue() ? this.appIdentity.value().version : '–'));
  protected readonly appCommit = computed(() => (this.appIdentity.hasValue() ? this.appIdentity.value().commit : 'unknown'));
  protected readonly apiVersion = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().version || '–' : '–'));
  protected readonly apiCommit = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().commit || 'unknown' : 'unknown'));
  protected readonly apiEnvironment = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().environment || '–' : '–'));
  /** Without the API's answer there is no mismatch to report; the error alert says what is missing. */
  protected readonly match = computed(() => this.apiFailed() || buildsMatch(this.appCommit(), this.apiCommit()));
  protected readonly shortCommit = shortCommit;

  constructor() {
    // The outcome of a retry the user started: its time when it failed again, the focus on the API heading when it
    // succeeded (the alert and the focused button disappear with the answer).
    effect(() => {
      const status = this.apiMeta.status();
      if (!untracked(this.retrying)) {
        return;
      }
      if (status === 'error') {
        this.retrying.set(false);
        this.retryFailedAt.set(new Date().toLocaleTimeString('de-DE'));
      } else if (status === 'resolved') {
        this.retrying.set(false);
        this.retryFailedAt.set('');
        afterNextRender(() => this.apiHeading()?.nativeElement.focus(), { injector: this.injector });
      }
    });
  }

  /** Ask the API again. A second press while the request runs does nothing; the button is busy, never disabled. */
  protected retry(): void {
    if (this.apiMeta.isLoading()) {
      return;
    }
    this.retrying.set(true);
    this.apiMeta.reload();
  }
}
