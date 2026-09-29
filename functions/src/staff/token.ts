import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// 32 bytes aleatórios em base64url: 43 caracteres, sem preenchimento.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

/** Token novo do convite. Vai só no link; o banco guarda o hash. */
export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

/** sha256 do token, em hexadecimal: o que fica em staffInvites/{id}.tokenHash. */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Confere o token do link contra o hash gravado, em tempo constante. Token
 * fora do formato ou hash estranho no banco nunca batem.
 */
export function tokenMatches(token: unknown, storedHash: unknown): boolean {
  if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) return false;
  if (typeof storedHash !== 'string' || !HASH_PATTERN.test(storedHash)) return false;
  const given = Buffer.from(hashInviteToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return given.length === stored.length && timingSafeEqual(given, stored);
}
