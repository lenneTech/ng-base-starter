/**
 * Where `/auth/verify-email` keeps what it needs across a reload: in the history entry, never in the URL.
 *
 * "Send a new e-mail" needs the address, and it used to travel as `?email=` from the login and the
 * sign-up. In the URL it went to analytics, into the referrer of links, into the browser history
 * and into every link somebody pasted while asking for help. The history entry keeps it out of all
 * of that and still survives a reload of the page.
 *
 * Login and sign-up hand it over with `router.navigate([path], { state: verifyEmailState(email) })`. The
 * link in the verification mail carries `token` (and, before nest-server 12.6.0, `email`), so the
 * page moves both out of the URL the moment it has read them. A link the server refused leaves its
 * token here, because from nest-server 12.6.0 on that token is what asks for a new mail.
 */

/** Key of the page's entry in `history.state`. */
const VERIFY_EMAIL_STATE_KEY = 'ltVerifyEmail';

/** What the history entry remembers for the page. A type, not an interface: it is stored in `history.state`, a plain record. */
export type VerifyEmailMemory = {
  /**
   * The token of a link the server refused, expired or otherwise dead; empty otherwise. Kept only
   * while the server takes it for a new mail (`POST /iam/resend-verification-email`), so a reload
   * still offers "send a new e-mail". It can no longer confirm anything.
   */
  deadToken: string;
  email: string;
  /** Set once the link was accepted, so a reload shows the confirmation rather than the waiting page. */
  verified: boolean;
};

/** The history state that hands the address, and the outcome, to `/auth/verify-email`. */
export function verifyEmailState(email: string, outcome: Partial<Omit<VerifyEmailMemory, 'email'>> = {}): Record<string, VerifyEmailMemory> {
  return { [VERIFY_EMAIL_STATE_KEY]: { deadToken: outcome.deadToken ?? '', email, verified: outcome.verified ?? false } };
}

/** What a history state remembers for the page, whatever else it holds. */
export function recallVerifyEmail(state: unknown): VerifyEmailMemory {
  const entry = state !== null && typeof state === 'object' ? (state as Record<string, unknown>)[VERIFY_EMAIL_STATE_KEY] : undefined;
  if (entry === null || typeof entry !== 'object') {
    return { deadToken: '', email: '', verified: false };
  }
  const { deadToken, email, verified } = entry as Record<string, unknown>;
  return { deadToken: typeof deadToken === 'string' ? deadToken : '', email: typeof email === 'string' ? email : '', verified: verified === true };
}
