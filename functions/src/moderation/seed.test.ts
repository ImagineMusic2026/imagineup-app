import { describe, expect, it } from 'vitest';

import { SEED_ENGAGEMENT } from '../posts/seed';
import { RANKING_SEED } from '../ranking/seed';
import { SEED_BLOCKS, SEED_PROFILE_REPORTS, SEED_SPAM_FAN, SEED_SUSPENDED_EMAIL } from './seed';

// O bloqueio e a denúncia de perfil do seed dos emuladores (seção 29, 29.10).
// O COMMENT_AUTHOR_ALIASES é do app: o teste das fixtures do app confere que o
// rank-13 não comenta lá.

describe('o seed das exigências das lojas (29.10)', () => {
  it('a Camila bloqueia o rank-13, e a Bia denuncia o perfil do Promo como spam', () => {
    expect(SEED_BLOCKS).toEqual([
      { blocker: 'camila@teste.imagineup', blocked: 'rank-13@teste.imagineup' },
    ]);
    expect(SEED_PROFILE_REPORTS).toEqual([
      { reporter: 'bia@teste.imagineup', target: SEED_SPAM_FAN.email, reason: 'spam' },
    ]);
  });

  it('o rank-13 existe no ranking, não é o suspenso e não aparece no engajamento do seed', () => {
    expect(RANKING_SEED.map((account) => account.email)).toContain('rank-13@teste.imagineup');
    expect(SEED_SUSPENDED_EMAIL).not.toBe('rank-13@teste.imagineup');
    const engagement = JSON.stringify(SEED_ENGAGEMENT);
    expect(engagement).not.toContain('rank-13');
    expect(engagement).not.toContain('rank13');
  });
});
