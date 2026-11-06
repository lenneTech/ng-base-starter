import { httpResource } from '@angular/common/http';
import { Component, computed, inject } from '@angular/core';
import { LtApiUrlService } from '@lenne.tech/ng-base';
import { HlmBadge, HlmCardImports, HlmSeparator, LtNotice } from '@lenne.tech/ng-base/ui';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { lucideLoaderCircle } from '@ng-icons/lucide';

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

/**
 * `/app/admin/system` (client-rendered): the running app and API build side by side, so a stale container after a
 * partial rollout shows at a glance. The app's commit comes from its own server (`/api/build-identity`), which can
 * read the prefix-free `APP_VERSION_COMMIT` a platform never blanks.
 */
@Component({
  imports: [HlmBadge, HlmCardImports, HlmSeparator, LtNotice, NgIcon],
  providers: [provideIcons({ lucideLoaderCircle })],
  selector: 'app-system-page',
  templateUrl: './system-page.html',
})
export class SystemPage {
  private readonly api = inject(LtApiUrlService);

  protected readonly apiMeta = httpResource<ApiMeta>(() => this.api.buildUrl('/meta'));
  protected readonly appIdentity = httpResource<BuildIdentity>(() => '/api/build-identity');

  protected readonly appVersion = computed(() => (this.appIdentity.hasValue() ? this.appIdentity.value().version : '–'));
  protected readonly appCommit = computed(() => (this.appIdentity.hasValue() ? this.appIdentity.value().commit : 'unknown'));
  protected readonly apiVersion = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().version || '–' : '–'));
  protected readonly apiCommit = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().commit || 'unknown' : 'unknown'));
  protected readonly apiEnvironment = computed(() => (this.apiMeta.hasValue() ? this.apiMeta.value().environment || '–' : '–'));
  protected readonly match = computed(() => buildsMatch(this.appCommit(), this.apiCommit()));
  protected readonly shortCommit = shortCommit;
}
