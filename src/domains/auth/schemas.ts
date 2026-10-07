import { z } from 'zod';

import { normalizeInviteCode } from '@/domains/invites';
import { t } from '@/i18n';
import { cleanLine, DISPLAY_NAME_MAX, isVisibleLine } from '@/utils/visible-line';

export const PASSWORD_MIN_LENGTH = 6;

export { DISPLAY_NAME_MAX };

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
 * pontos de código (um emoji vale 1), por isso a conta é feita à mão. A
 * tela "Editar perfil" (bloco 9) usa o mesmo campo.
 */
export const nameField = z
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

/**
 * "Código de convite (opcional)": vazio é "sem código"; senão, o código
 * normalizado (sem espaços nem hífens, em maiúsculas), ou o erro quando ele
 * não tem o formato. Quem confere se ele existe é o servidor, no claim.
 */
export const inviteCodeField = z
  .string()
  .optional()
  .transform((value = '', ctx) => {
    if (!value.trim()) return '';
    const code = normalizeInviteCode(value);
    if (code) return code;
    ctx.addIssue({ code: 'custom', message: t('validation.inviteCodeInvalid') });
    return z.NEVER;
  });

export const signUpSchema = z.object({
  name: nameField,
  email: emailField,
  password: passwordField,
  inviteCode: inviteCodeField,
});

/** O que o formulário guarda (texto cru) e o que o envio recebe (já limpo). */
export type SignUpFormInput = z.input<typeof signUpSchema>;
export type SignUpForm = z.output<typeof signUpSchema>;

/** Só o e-mail, para o "Esqueci minha senha" usar o que foi digitado no login. */
export const resetEmailSchema = emailField;

/**
 * A senha que o Firebase pede de novo para excluir a conta com login antigo.
 * Só não pode ir vazia: quem confere é o Firebase (senha errada volta como
 * erro no campo), e uma conta antiga pode ter senha mais curta que a regra de hoje.
 */
export const reauthSchema = z.object({
  password: z.string().min(1, { error: t('deleteAccount.passwordRequired') }),
});

export type ReauthForm = z.infer<typeof reauthSchema>;
