import { z } from 'zod';

import { t } from '@/i18n';

export const PASSWORD_MIN_LENGTH = 6;

export const signInSchema = z.object({
  email: z
    .email({ error: t('validation.emailInvalid') })
    .trim()
    .toLowerCase(),
  password: z
    .string()
    .min(PASSWORD_MIN_LENGTH, { error: t('validation.passwordMin', { min: PASSWORD_MIN_LENGTH }) }),
});

export type SignInForm = z.infer<typeof signInSchema>;
