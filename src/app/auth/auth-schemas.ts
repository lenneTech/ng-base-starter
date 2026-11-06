import * as v from 'valibot';

/**
 * The Valibot schemas of the auth forms, with the German messages of the Nuxt template (A.8). Passwords are hashed
 * (SHA-256) in the client before they leave the browser, so the server's length checks see 64 hex characters: the
 * `minLength` here is the only length rule a user ever meets, and there is deliberately no upper bound.
 */

const email = v.pipe(v.string('E-Mail ist erforderlich'), v.nonEmpty('E-Mail ist erforderlich'), v.email('Bitte eine gültige E-Mail eingeben'));

export const loginSchema = v.object({
  email,
  password: v.pipe(v.string('Passwort ist erforderlich'), v.minLength(5, 'Mindestens 5 Zeichen erforderlich')),
});

export type LoginModel = v.InferOutput<typeof loginSchema>;

const newPassword = v.pipe(v.string('Passwort ist erforderlich'), v.minLength(8, 'Mindestens 8 Zeichen erforderlich'));
const confirmPassword = v.pipe(v.string('Passwortbestätigung ist erforderlich'), v.minLength(8, 'Mindestens 8 Zeichen erforderlich'));
const registerFields = {
  confirmPassword,
  email,
  name: v.pipe(v.string('Name ist erforderlich'), v.minLength(2, 'Mindestens 2 Zeichen erforderlich')),
  password: newPassword,
};

/** Sign-up without the terms checkbox (`features.signUpChecks` off). */
export const registerSchema = v.pipe(
  v.object(registerFields),
  v.forward(
    v.partialCheck([['password'], ['confirmPassword']], (input) => input.password === input.confirmPassword, 'Passwörter stimmen nicht überein'),
    ['confirmPassword'],
  ),
);

/** Sign-up with the terms checkbox (`features.signUpChecks === true`). */
export const registerWithTermsSchema = v.pipe(
  v.object({ ...registerFields, termsAccepted: v.pipe(v.optional(v.boolean(), false), v.literal(true, 'Bitte akzeptiere die AGB und Datenschutzerklärung')) }),
  v.forward(
    v.partialCheck([['password'], ['confirmPassword']], (input) => input.password === input.confirmPassword, 'Passwörter stimmen nicht überein'),
    ['confirmPassword'],
  ),
);

export interface RegisterModel {
  confirmPassword: string;
  email: string;
  name: string;
  password: string;
  termsAccepted: boolean;
}

export const twoFactorSchema = v.object({
  code: v.pipe(v.string('Code ist erforderlich'), v.minLength(6, 'Code muss mindestens 6 Zeichen haben')),
});

export type TwoFactorModel = v.InferOutput<typeof twoFactorSchema>;

export const forgotPasswordSchema = v.object({ email });

export type ForgotPasswordModel = v.InferOutput<typeof forgotPasswordSchema>;

/**
 * `minLength(8)` is NOT cosmetic: it is the only length check there is. The password is hashed before it leaves the
 * browser, so the server's `minPasswordLength` compares against 64 hex characters and always passes. For the same
 * reason there is no upper bound: it would reject passwords the server accepts.
 */
export const resetPasswordSchema = v.pipe(
  v.object({ confirmPassword, password: newPassword }),
  v.forward(
    v.partialCheck([['password'], ['confirmPassword']], (input) => input.password === input.confirmPassword, 'Passwörter stimmen nicht überein'),
    ['confirmPassword'],
  ),
);

export type ResetPasswordModel = v.InferOutput<typeof resetPasswordSchema>;

/** The fallback form of the verify-email page, when it knows neither the address nor a token that stands in for it. */
export const verifyAddressSchema = v.object({
  email: v.pipe(
    v.string('Bitte gib deine E-Mail-Adresse ein.'),
    v.trim(),
    v.nonEmpty('Bitte gib deine E-Mail-Adresse ein.'),
    v.email('Bitte gib eine gültige E-Mail-Adresse ein.'),
  ),
});

export type VerifyAddressModel = v.InferOutput<typeof verifyAddressSchema>;

/** First-admin setup: the sign-up fields plus the setup token (required only while the API asks for one). */
export const setupSchema = v.pipe(
  v.object({ ...registerFields, token: v.optional(v.string()) }),
  v.forward(
    v.partialCheck([['password'], ['confirmPassword']], (input) => input.password === input.confirmPassword, 'Passwörter stimmen nicht überein'),
    ['confirmPassword'],
  ),
);

export interface SetupModel {
  confirmPassword: string;
  email: string;
  name: string;
  password: string;
  token: string;
}
