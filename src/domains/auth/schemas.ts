import { z } from 'zod';

import { t } from '@/i18n';

export const PASSWORD_MIN_LENGTH = 6;

export const signInSchema = z.object({
  // Normaliza antes de validar: no zod 4 o formato do z.email() roda antes de
  // um .trim() encadeado, e o espaço da sugestão do teclado barraria o login.
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email({ error: t('validation.emailInvalid') })),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: t('validation.passwordMin', { min: PASSWORD_MIN_LENGTH }) }),
});

export type SignInForm = z.infer<typeof signInSchema>;
