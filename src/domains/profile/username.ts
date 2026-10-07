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
