/**
 * Chave de idempotência para ações que podem ser repetidas quando a internet
 * volta (curtir, comentar). O servidor ignora a segunda chegada da mesma chave,
 * e o fã não ganha ponto em dobro.
 */
export function createIdempotencyKey(): string {
  const time = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${time}-${random}`;
}
