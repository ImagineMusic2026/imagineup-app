import type { FanProfile, UsernameLockReason } from './types';

/**
 * O @ do fã como o servidor confere (espelho de `normalizeUsername`,
 * `USERNAME_PATTERN` e `AUTOMATIC_USERNAME` de `functions/src/fan-profile/model.ts`;
 * mudou um, mude o outro e os testes dos dois). A lista dos reservados fica
 * só no servidor: a resposta `reserved` da disponibilidade diz ao app.
 * docs/arquitetura-api.md, 24.1, decisão 3.
 */

/** @ do fã: minúsculas e números, de 3 a 20 (o mesmo do cadastro). */
export const USERNAME_PATTERN = /^[a-z0-9]{3,20}$/;

/** O @ automático (`fa` com dígitos): só o gerador do servidor cria. */
export const AUTOMATIC_USERNAME = /^fa[0-9]+$/;

/**
 * Só o óbvio: sem os espaços das pontas e sem um `@` do começo, em
 * minúsculas. Acento não vira letra: o fã vê o que vai mandar.
 */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@/, '').toLowerCase();
}

/** O @ está no formato que o servidor aceita (conferido antes de qualquer pedido). */
export const isUsernameFormat = (username: string): boolean => USERNAME_PATTERN.test(username);

/** O @ é o automático do cadastro: a tela destaca e convida a trocar. */
export function isAutomaticUsername(username: string | null | undefined): boolean {
  return !!username && AUTOMATIC_USERNAME.test(username);
}

/**
 * Quem pôs o prazo do @, como o servidor grava (espelho do `lockReasonOf` de
 * `functions/src/fan-profile/details.ts`, seção 32, decisão 2): só
 * `moderation`; o ausente (o perfil de antes), `null` e qualquer outro valor
 * valem `null`.
 */
export const lockReasonOf = (value: unknown): UsernameLockReason | null =>
  value === 'moderation' ? 'moderation' : null;

/** O prazo do @ que ainda corre: até quando (ISO) e se foi a equipe que o pôs. */
export interface UsernameLock {
  until: string;
  byTeam: boolean;
}

/**
 * O @ está travado agora? O prazo do perfil no futuro, pelo relógio do
 * aparelho, com quem o pôs (`moderation`: a equipe trocou o @, seção 32); sem
 * prazo, com ele vencido ou fora do formato, `null`. A tela "Editar perfil"
 * lê daqui (os Ajustes, até 26/10/2026). A recusa 409 do servidor (o relógio do aparelho
 * adiantado, ou o cache sem o prazo) a tela trata à parte.
 */
export function usernameLock(
  profile: Pick<FanProfile, 'usernameChangeableAt' | 'usernameLockReason'> | null | undefined,
  now: Date,
): UsernameLock | null {
  const until = profile?.usernameChangeableAt ?? null;
  if (!until) return null;
  const at = Date.parse(until);
  if (Number.isNaN(at) || at <= now.getTime()) return null;
  return { until, byTeam: lockReasonOf(profile?.usernameLockReason) === 'moderation' };
}
