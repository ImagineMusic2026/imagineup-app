/**
 * Por que o e-mail chega pronto à tela de entrar:
 * - `prefill`: só para não digitar de novo;
 * - `emailInUse`: o cadastro descobriu, ao criar a conta, que o e-mail já tem
 *   uma. A tela de entrar abre na senha e diz por quê.
 */
export type EmailHandoffReason = 'prefill' | 'emailInUse';

/**
 * E-mail que o cadastro passa para o entrar quando ele já tem conta. Fica só
 * na memória, e não num parâmetro da rota, para o e-mail não entrar no
 * endereço da tela.
 */
let handedOff: { email: string; reason: EmailHandoffReason } | null = null;

export function handOffEmail(email: string, reason: EmailHandoffReason = 'prefill'): void {
  handedOff = { email, reason };
}

/** Lê sem apagar: quem lê apaga depois de montar (`clearHandedOffEmail`). */
export function readHandedOffEmail(): string | null {
  return handedOff?.email ?? null;
}

/** O motivo do e-mail guardado, ou `null` sem e-mail. Lê sem apagar. */
export function readEmailHandoffReason(): EmailHandoffReason | null {
  return handedOff?.reason ?? null;
}

export function clearHandedOffEmail(): void {
  handedOff = null;
}
