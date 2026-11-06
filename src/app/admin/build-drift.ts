/**
 * Build drift between app and API, judged by COMMIT, never by version: app and API are versioned independently, so
 * differing version numbers are normal. Both images take the commit of the same CI run, so a commit mismatch means a
 * partial or stale rollout. `unknown` (local builds) never warns.
 */
export function buildsMatch(appCommit: string | null | undefined, apiCommit: string | null | undefined): boolean {
  if (!appCommit || !apiCommit || appCommit === 'unknown' || apiCommit === 'unknown') {
    return true;
  }
  return appCommit === apiCommit;
}

/** The first 7 characters of a commit, or a readable placeholder. */
export function shortCommit(commit: string | null | undefined): string {
  return !commit || commit === 'unknown' ? 'unbekannt' : commit.slice(0, 7);
}
