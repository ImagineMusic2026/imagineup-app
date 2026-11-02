import { describe, expect, it } from 'vitest';

import { socialsWithoutLinkedin } from './drop-linkedin';

// A carga do LinkedIn (saiu em 02/11/2026), sem o Firestore: o mapa que a
// transação grava. A carga inteira roda em functions/test/profile-edit.emulator.test.ts.
describe('socialsWithoutLinkedin', () => {
  it('sem mapa ou sem a chave: nada a mudar', () => {
    expect(socialsWithoutLinkedin(undefined)).toBeUndefined();
    expect(socialsWithoutLinkedin(null)).toBeUndefined();
    expect(socialsWithoutLinkedin('thalita')).toBeUndefined();
    expect(socialsWithoutLinkedin(['linkedin'])).toBeUndefined();
    expect(socialsWithoutLinkedin({ instagram: 'thalita.teste.up', x: null })).toBeUndefined();
  });

  it('tira só a chave, com o resto como estava', () => {
    expect(
      socialsWithoutLinkedin({
        instagram: 'thalita.teste.up',
        tiktok: null,
        linkedin: 'thalita-teste',
        x: 'Fora Do Padrão',
      }),
    ).toEqual({ instagram: 'thalita.teste.up', tiktok: null, x: 'Fora Do Padrão' });
  });

  it('sem nenhuma das redes de agora com texto, o mapa vira null', () => {
    expect(socialsWithoutLinkedin({ linkedin: 'thalita-teste' })).toBeNull();
    expect(
      socialsWithoutLinkedin({ instagram: null, tiktok: '', linkedin: 'thalita-teste', x: null }),
    ).toBeNull();
    expect(socialsWithoutLinkedin({ linkedin: null, outra: 'zz' })).toBeNull();
  });
});
