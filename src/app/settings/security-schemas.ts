import * as v from 'valibot';

/** Password confirmation of the security settings (any length: the server checks it). */
export const confirmPasswordSchema = v.object({
  password: v.pipe(v.string('Passwort ist erforderlich'), v.minLength(1, 'Passwort ist erforderlich')),
});

export const totpCodeSchema = v.object({
  code: v.pipe(v.string('Code ist erforderlich'), v.length(6, 'Code muss 6 Ziffern haben')),
});

export interface PasswordModel {
  password: string;
}

export interface TotpCodeModel {
  code: string;
}
