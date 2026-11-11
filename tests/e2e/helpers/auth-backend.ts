/**
 * Reset test data, read the backend log, and find the verification token in it.
 *
 * These lived as verbatim copies in `auth-lifecycle.spec.ts` and `auth-feature-order.spec.ts`.
 * Two copies of a MongoDB reset and a log search is exactly the kind of duplication that
 * drifts silently, and it already had: the two `Features` interfaces declared *different
 * fields* (one was missing `resendCooldownSeconds` and `socialProviders`), so the contract
 * against `/iam/features` had diverged at the type level, not just in comments.
 *
 * `MONGO_URI` and `COLLECTIONS` stay module-private on purpose — they are implementation
 * detail of `resetTestData`, and a spec that reaches for them directly is a spec that has
 * started doing database work of its own.
 *
 * Setup, configuration scenarios and locator conventions: `docs/e2e-auth.md`.
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { MongoClient } from 'mongodb';

/**
 * The auth features the backend reports at `GET /iam/features`.
 *
 * Kept complete rather than trimmed to what a given spec reads: a per-spec subset is not a
 * narrower contract, it is an incomplete transcription — which is precisely how the two
 * previous copies drifted apart.
 *
 * @see The nest-server side is `CoreBetterAuthController.getFeatures()`.
 */
export interface Features {
  /** Email verification is required before login. */
  emailVerification: boolean;
  /** The auth module is active at all. */
  enabled: boolean;
  /** JWT mode instead of cookie sessions. */
  jwt: boolean;
  /** Passkey (WebAuthn) registration and login are available. */
  passkey: boolean;
  /** Cooldown between two verification-mail resends, in seconds. */
  resendCooldownSeconds: number;
  /**
   * `POST /iam/resend-verification-email` takes the token of a verification link (nest-server
   * 12.6.0+). Off by default, unlike the other flags: an older server lacks the endpoint, so a
   * missing key really means "not there".
   */
  resendVerificationByToken: boolean;
  /** Registration requires the terms checkbox. */
  signUpChecks: boolean;
  /** Registration is open at all. */
  signUpEnabled: boolean;
  /** Ids of the configured OAuth providers; empty when none are set up. */
  socialProviders: string[];
  /** Two-factor (TOTP) is available. */
  twoFactor: boolean;
}

/**
 * What the suite assumes when `/iam/features` cannot be reached.
 *
 * Values match the backend's own defaults (`resendCooldownSeconds ?? 60`, no providers
 * configured), so a run against an unreachable endpoint at least exercises a configuration
 * that could exist. Exported so the two specs share one copy instead of two literals that
 * drift the way their interfaces did.
 */
export const DEFAULT_FEATURES: Features = {
  emailVerification: true,
  enabled: true,
  jwt: false,
  passkey: true,
  resendCooldownSeconds: 60,
  resendVerificationByToken: false,
  signUpChecks: true,
  signUpEnabled: true,
  socialProviders: [],
  twoFactor: true,
};

/**
 * Accept a `/iam/features` response only when it actually looks like one.
 *
 * `await response.json() as Features` is the trap this closes: a 200 carrying `{}` — a
 * disabled module, a proxy returning an empty body — would produce an object typed as fully
 * populated with every flag `undefined`. Every `if (features.emailVerification)` then takes
 * the "feature off" branch, the suite goes green, and it has tested a configuration nobody
 * chose. Nothing throws, so a `catch`-based fallback never fires either.
 *
 * @param json Parsed response body of unknown shape.
 * @returns The payload merged over {@link DEFAULT_FEATURES}, or the defaults when it is not a
 *   recognisable feature payload.
 */
export function parseFeatures(json: unknown): Features {
  if (typeof json !== 'object' || json === null || typeof (json as Features).enabled !== 'boolean') {
    return { ...DEFAULT_FEATURES };
  }

  return { ...DEFAULT_FEATURES, ...(json as Partial<Features>) };
}

// Env-driven so the same suite runs against classic ports (3000/3001), a `lt dev up` session
// (https://<slug>.localhost via the .lt-dev/.env bridge) and CI. Falls back to the classic
// localhost defaults when nothing is set.
//
// Deliberately NOT the development database: `resetTestData` deletes rows, and pointing its
// default at the database a developer also runs the app against is a hazard with no upside.
const MONGO_URI = process.env.NSC__MONGOOSE__URI || process.env.MONGO_URI || 'mongodb://127.0.0.1/nest-server-e2e';

/**
 * Base URL of the nest-server API under test.
 *
 * Resolved from `NG_PUBLIC_API_URL`, then `API_URL`, then `http://localhost:3000`.
 */
export const API_BASE = process.env.NG_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3000';

/**
 * Base URL of the Angular app under test.
 *
 * Resolved from `NG_PUBLIC_SITE_URL`, then `APP_URL`, then `http://localhost:3001`.
 */
export const FRONTEND_BASE = process.env.NG_PUBLIC_SITE_URL || process.env.APP_URL || 'http://localhost:3001';

// Better-Auth collection names (default without prefix), plus the AI module's per-user
// settings (nest-server 12.3.0), which the MCP confirmation spec writes
const COLLECTIONS = ['session', 'account', 'verification', 'passkey', 'twoFactor', 'backupCode', 'aiUserSettings'];

/** Loopback hosts — the only ones `resetTestData` will delete from without an explicit opt-in. */
const LOOPBACK_URI = /^mongodb(\+srv)?:\/\/(?:[^@/]*@)?(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

/** Refuse to write unless `MONGO_URI` is loopback, or `E2E_ALLOW_REMOTE_DB=true` opts in. */
function assertLocalDatabase(): void {
  if (process.env.E2E_ALLOW_REMOTE_DB !== 'true' && !LOOPBACK_URI.test(MONGO_URI)) {
    throw new Error(
      `Refusing to delete test data: MONGO_URI is not loopback (${MONGO_URI.replace(/\/\/[^@]*@/, '//***@')}). ` +
        'Set E2E_ALLOW_REMOTE_DB=true only if you really mean to write to a remote database.',
    );
  }
}

/**
 * Refuse to delete unless both the target database and the account are unmistakably test-only.
 *
 * The safety today rests on an accident: every caller happens to pass a `generateTestUser()`
 * address, so `findOne({ email })` misses and the whole function is a no-op. That property
 * lives in the callers, not in the function — and this is now an exported helper in a
 * `helpers/` directory that consumer projects are meant to build on. The first caller that
 * passes a fixed address (a seeded `admin@…`, a "clean up the demo account" step) inherits an
 * unguarded delete against whatever `MONGO_URI` names, which is shell-driven and uncorrelated
 * with the `API_BASE` the browser is actually driving.
 */
function assertSafeToDelete(email: string): void {
  assertLocalDatabase();
  if (!email.endsWith('@test.com')) {
    throw new Error(`Refusing to delete "${email}": resetTestData only handles @test.com addresses. Use generateTestUser().`);
  }
}

/**
 * Remove a test user and everything Better-Auth hung off it.
 *
 * Deleting the user alone is not enough: sessions, accounts, pending verifications, passkeys
 * and 2FA rows survive it and leak into the next run, which is how an auth suite starts
 * failing only on the second execution. Each collection is deleted defensively because a
 * fresh database has not necessarily created all of them yet.
 *
 * @param email Address of the user to remove; must be `@test.com`. A no-op when no such user
 *   exists.
 * @throws When `MONGO_URI` is not loopback (unless `E2E_ALLOW_REMOTE_DB=true`), or when the
 *   address is not a test address.
 */
/**
 * Wait for the password-reset token that Better Auth issued for `email`.
 *
 * WHY THIS IS NOT `waitForVerificationToken`. The two flows carry different things.
 * Email verification signs a stateless JWT, so its token can be pulled out of the server
 * log and matched by decoding its payload. A reset token is the opposite: `generateId(24)`,
 * opaque, with nothing inside it to match on. Better Auth stores it as a `verification`
 * document — `identifier: "reset-password:<token>"`, `value: <userId>` — and the log line
 * carries a MASKED address (`2f***@test.com`), which is not distinctive between two test
 * users whose addresses share a prefix. So the database is the only place this can be read
 * per user rather than per run.
 *
 * The lookup goes users → _id → verification.value, because `value` holds the user id and
 * nothing else ties the document to an address.
 *
 * @param email Address whose reset was requested.
 * @param maxRetries Attempts before giving up; each is followed by a 500 ms wait.
 * @returns The raw token to put in `?token=`, or `null` once the attempts are exhausted.
 */
export async function waitForPasswordResetToken(email: string, maxRetries = 10): Promise<null | string> {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();

    for (let i = 0; i < maxRetries; i++) {
      const user = await db.collection('users').findOne({ email });
      if (user) {
        // Newest first: a spec may request a reset more than once, and only the last token
        // is still redeemable.
        const doc = await db.collection('verification').findOne({ identifier: { $regex: '^reset-password:' }, value: user._id.toString() }, { sort: { createdAt: -1 } });

        const token = doc?.identifier?.slice('reset-password:'.length);
        if (token) {
          return token;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    return null;
  } finally {
    await client.close();
  }
}

export async function resetTestData(email: string): Promise<void> {
  assertSafeToDelete(email);

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();

    // Try to find user in the 'users' collection (Better-Auth modelName)
    const user = await db.collection('users').findOne({ email });
    if (user) {
      const userId = user._id.toString();
      for (const coll of COLLECTIONS) {
        try {
          await db.collection(coll).deleteMany({ userId });
        } catch {
          // Collection may not exist yet
        }
      }
      try {
        await db.collection('webauthn_challenge_mappings').deleteMany({ userId });
      } catch {
        // Collection may not exist
      }
      // AI prompts name their author as `ownerId`, not `userId` (tests/e2e/ai-prompts-include-disabled.spec.ts).
      try {
        await db.collection('aiPrompts').deleteMany({ ownerId: { $in: [userId, user._id] } });
      } catch {
        // Collection may not exist (AI module off)
      }
      // Also clean verification by identifier (email)
      try {
        await db.collection('verification').deleteMany({ identifier: email });
      } catch {
        // Collection may not exist
      }
      await db.collection('users').deleteOne({ _id: user._id });
    }
  } finally {
    await client.close();
  }
}

/**
 * Give a test user the admin role, as an operator would in the database (the Nuxt template's helper, #41).
 *
 * The suite has no other way to an admin: the first admin belongs to the setup, and a test user cannot grant itself a
 * role through the API. nest-server keeps the roles in `users.roles`; the app reads them from the session at sign-in,
 * so the user has to sign in again afterwards. nest-server answers a user's roles from a 15-second cache, which a
 * write here does not reach, unless the API runs with `PLAYWRIGHT=true` (nest-server 11.25.6 or later; the CI job
 * sets it) or under `lt dev up` / `lt dev test` (`LT_DEV_ACTIVE`). Against an API started otherwise, the new sign-in
 * still carries no admin role.
 *
 * @param email Address of the user; must be `@test.com`, like every address {@link resetTestData} cleans up.
 * @throws When `MONGO_URI` is not loopback (unless `E2E_ALLOW_REMOTE_DB=true`), when the address is not a test
 *   address, or when no user has it.
 */
export async function grantAdminRole(email: string): Promise<void> {
  assertSafeToDelete(email);

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const result = await client
      .db()
      .collection('users')
      .updateOne({ email }, { $set: { roles: ['admin'] } });
    if (result.matchedCount !== 1) {
      throw new Error(`No user "${email}" to grant the admin role to`);
    }
  } finally {
    await client.close();
  }
}

/**
 * Release the initial-admin claim that a successful `POST /system-setup/init` leaves behind.
 *
 * nest-server removes its `system-setup-locks` marker only when creating the admin FAILS. A spec
 * that sets the system up and deletes that admin afterwards therefore leaves zero users AND a
 * held claim: `needsSetup` reports true, init answers 403 until the claim goes stale after five
 * minutes, and the spec fails its own re-run — as does `/auth/setup` for a developer in that
 * window. Call it after {@link resetTestData} removed the admin the spec created.
 *
 * The marker is deleted only while no user exists, so this can never reopen the setup of an
 * installation that has an admin.
 *
 * @throws When `MONGO_URI` is not loopback (unless `E2E_ALLOW_REMOTE_DB=true`).
 */
export async function releaseSystemSetupClaim(): Promise<void> {
  assertLocalDatabase();

  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db();
    if ((await db.collection('users').countDocuments({})) === 0) {
      await db.collection<{ _id: string }>('system-setup-locks').deleteOne({ _id: 'initial-admin' });
    }
  } finally {
    await client.close();
  }
}

/**
 * Read the backend server log(s) that carry the email-verification lines.
 *
 * Honours `NEST_SERVER_LOG`, then searches upward from cwd for the `lt dev` log files
 * (`.lt-dev/api.test.log` under `lt dev test`, `.lt-dev/api.log` under `lt dev up`), then the
 * classic `/tmp/nest-server.log`. The upward search stops at the FIRST directory that has one,
 * so a project nested under another `lt dev` workspace does not concatenate the parent's log —
 * which would mix a foreign stack's tokens into this run's search space.
 *
 * All remaining candidates are concatenated so the token is found regardless of which file the
 * active stack writes to.
 *
 * **The result contains live bearer credentials.** See `docs/e2e-auth.md`.
 *
 * @returns The concatenated log content, or an empty string when no candidate exists.
 */
export function readServerLog(): string {
  const candidates: string[] = [];
  if (process.env.NEST_SERVER_LOG) {
    candidates.push(process.env.NEST_SERVER_LOG);
  }

  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const here = ['.lt-dev/api.test.log', '.lt-dev/api.log'].map((rel) => path.resolve(dir, rel)).filter((file) => fs.existsSync(file));
    if (here.length > 0) {
      // The first `.lt-dev/` found upward is THIS project's — do not keep climbing into
      // siblings or an unrelated parent workspace.
      candidates.push(...here);
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  candidates.push('/tmp/nest-server.log');

  let content = '';
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);

    let file: string;
    try {
      file = fs.readFileSync(resolved, 'utf-8');
    } catch {
      // Candidate log file does not exist — skip.
      continue;
    }
    // Deliberately OUTSIDE the try: a `RangeError: Invalid string length` from concatenating
    // past V8's ~512 MiB string limit must not be swallowed by a catch that means "no such
    // file". It would return a truncated log and the suite would report "token not found",
    // pointing the debugger at the backend instead of at this reader.
    content += file + '\n';
  }

  return content;
}

/**
 * The pseudonym nest-server 12.6.0+ prints for an address in its auth-URL log lines.
 *
 * `UserKey` is the first 16 hex characters of the SHA-256 of the trimmed, lower-cased address
 * (`CoreBetterAuthEmailVerificationService` in nest-server). It tells a test which line belongs
 * to which account without the address standing in the log.
 *
 * @param email Address as a spec passes it; trimmed and lower-cased here, as on the server.
 * @returns The 16-character key.
 */
export function userKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 16);
}

/** The address in the payload of a readable JWT, or `undefined` for anything else. */
function jwtEmail(token: string): string | undefined {
  const payload = token.split('.')[1];
  if (!payload) {
    return undefined;
  }
  try {
    const decoded: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    const email = typeof decoded === 'object' && decoded !== null ? (decoded as { email?: unknown }).email : undefined;
    return typeof email === 'string' ? email : undefined;
  } catch {
    // Not a JWT we can read — skip it rather than guessing.
    return undefined;
  }
}

/**
 * Find the freshest email-verification token for `email` in a backend log.
 *
 * The log line MASKS the address (`pa***@test.com`), so it cannot be matched directly.
 * Rebuilding the mask here would duplicate `maskEmail()` from the nest-server core — it drifts
 * the moment the core changes how it masks — and it is ambiguous: two test addresses sharing
 * the first two characters (`comprehensive-…` and `contact-…` both mask to `co***`) would hand
 * back the wrong user's token, sporadically. Two formats name the account instead:
 *
 * - **nest-server 12.6.0+** seals the token (a JWE nobody can read) and prints
 *   `[EMAIL VERIFICATION] User: <masked>, UserKey: <16 hex>, URL: <link>`. The line is matched
 *   by {@link userKey}; a line with a `UserKey` is never read any other way.
 * - **Older servers** print the link with Better-Auth's readable JWT, which carries the address
 *   in its payload. A line without a `UserKey` is matched by that payload.
 *
 * The signature is deliberately not verified: this selects among tokens the backend just
 * emitted, it does not trust one. Authority stays with the backend, which verifies the
 * signature when the token is redeemed.
 *
 * @param log Log content, as returned by {@link readServerLog}.
 * @param email Address to find a token for; compared trimmed and case-insensitively, because
 *   Better-Auth signs `email.toLowerCase()` into the payload and nest-server keys the trimmed,
 *   lower-cased address.
 * @returns The last matching token in the log, or `null` when there is none.
 */
export function findVerificationToken(log: string, email: string): null | string {
  const wanted = email.trim().toLowerCase();
  const wantedKey = userKey(email);
  let token: null | string = null;

  for (const line of log.split('\n')) {
    if (!line.includes('[EMAIL VERIFICATION]')) {
      continue;
    }
    const candidate = /[?&]token=([^&\s]+)/.exec(line)?.[1];
    if (!candidate) {
      continue;
    }
    const lineKey = /\bUserKey: ([0-9a-f]{16})\b/.exec(line)?.[1];
    if (lineKey === undefined ? jwtEmail(candidate) === wanted : lineKey === wantedKey) {
      token = candidate;
    }
  }

  return token;
}

/**
 * Poll the backend log until the verification token for `email` shows up.
 *
 * The backend logs the line before it sends the mail, so it normally appears within one
 * interval. Known blind spot: a resend suppressed by the backend's own cooldown logs nothing,
 * so this returns the PREVIOUS token for that address — which then fails at redemption. If a
 * spec resends because the first token was already consumed, expect that.
 *
 * @param email Address to wait for.
 * @param maxRetries Attempts before giving up; each is followed by a 500 ms wait.
 * @returns The token, or `null` once the attempts are exhausted.
 */
export async function waitForVerificationToken(email: string, maxRetries = 10): Promise<null | string> {
  for (let i = 0; i < maxRetries; i++) {
    const token = findVerificationToken(readServerLog(), email);
    if (token) {
      return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return null;
}
