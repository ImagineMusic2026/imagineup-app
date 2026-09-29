import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { hashInviteToken, newInviteToken, tokenMatches } from './token';

describe('token do convite', () => {
  it('32 bytes aleatórios em base64url, sem preenchimento', () => {
    const token = newInviteToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(newInviteToken()).not.toBe(token);
  });

  it('o banco guarda o sha256 em hexadecimal', () => {
    const token = newInviteToken();
    expect(hashInviteToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashInviteToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('só o token certo bate com o hash', () => {
    const token = newInviteToken();
    const hash = hashInviteToken(token);
    expect(tokenMatches(token, hash)).toBe(true);
    expect(tokenMatches(newInviteToken(), hash)).toBe(false);
  });

  it('token fora do formato ou hash estranho nunca batem', () => {
    const token = newInviteToken();
    const hash = hashInviteToken(token);
    for (const given of [undefined, null, 42, '', `${token}=`, token.slice(1), ` ${token}`]) {
      expect(tokenMatches(given, hash)).toBe(false);
    }
    for (const stored of [undefined, null, '', hash.toUpperCase(), hash.slice(2), `${hash}00`]) {
      expect(tokenMatches(token, stored)).toBe(false);
    }
  });
});
