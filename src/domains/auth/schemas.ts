import { z } from 'zod';

import { t } from '@/i18n';
import { cleanLine, isVisibleLine } from '@/utils/visible-line';

export const PASSWORD_MIN_LENGTH = 6;

/** Limite do nome no `firestore.rules` e na função de cadastro. */
export const DISPLAY_NAME_MAX = 60;

// Normaliza antes de validar: no zod 4 o formato do z.email() roda antes de
// um .trim() encadeado, e o espaço da sugestão do teclado barraria o login.
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ error: t('validation.emailInvalid') }));

const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: t('validation.passwordMin', { min: PASSWORD_MIN_LENGTH }) });

/**
 * Nome com as mesmas regras do `firestore.rules` e da função de cadastro: uma
 * linha visível de 1 a 60. O texto colado perde os isolantes bidi (a regra os
 * recusa) e os espaços das pontas, e os acentos são juntados (NFC). O tamanho
 * conta unidades de UTF-16, como a função: nunca menos que a conta das regras,
 * e o nome chega ao perfil sem perder palavras. O `.max()` do zod 4 conta
 * pontos de código (um emoji vale 1), por isso a conta é feita à mão.
 */
const nameField = z
  .string()
  .transform(cleanLine)
  .pipe(
    z
      .string()
      .min(1, { error: t('validation.nameRequired') })
      .refine((name) => name.length <= DISPLAY_NAME_MAX, {
        error: t('validation.nameMax', { max: DISPLAY_NAME_MAX }),
      })
      .refine(isVisibleLine, { error: t('validation.nameInvalid') }),
  );

export const signInSchema = z.object({
  email: emailField,
  password: passwordField,
});

export type SignInForm = z.infer<typeof signInSchema>;

export const signUpSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
});

/** O que o formulário guarda (texto cru) e o que o envio recebe (já limpo). */
export type SignUpFormInput = z.input<typeof signUpSchema>;
export type SignUpForm = z.output<typeof signUpSchema>;

/** Só o e-mail, para o "Esqueci minha senha" usar o que foi digitado no login. */
export const resetEmailSchema = emailField;
