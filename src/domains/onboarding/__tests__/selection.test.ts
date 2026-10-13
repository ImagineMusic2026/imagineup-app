import type { Artist } from '@/domains/artists';
import { t } from '@/i18n';

import { MIN_ARTISTS } from '../consts';
import {
  continueLabel,
  minimumArtists,
  missingArtists,
  needMoreHint,
  splitFeatured,
} from '../selection';

// O build do Firebase que o Jest resolve é ESM. A escolha não fala com ele, mas
// a ordem de destaque vem do index do domínio de artistas, que chega à API.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));

const artist = (id: string, name: string, order: number): Artist => ({
  id,
  name,
  photoURL: null,
  fanCount: 1_000,
  order,
});

const artists = [
  artist('rock', 'Rock Salles', 3),
  artist('netto', 'Netto Brito', 0),
  artist('a5', 'Artista 5', 4),
  artist('nenho', 'Nenho', 1),
  artist('angela', 'Ângela Maria', 5),
  artist('juninho', 'Juninho Moraes', 2),
];

describe('grade da escolha de artistas', () => {
  it('os primeiros pela ordem de destaque vão para a grade, o resto para o "+N"', () => {
    const { featured, rest } = splitFeatured(artists, 4);
    expect(featured.map((item) => item.id)).toEqual(['netto', 'nenho', 'juninho', 'rock']);
    expect(rest.map((item) => item.id)).toEqual(['a5', 'angela']);
  });

  it('com poucos artistas, todos vão para a grade', () => {
    const { featured, rest } = splitFeatured(artists.slice(0, 2), 4);
    expect(featured).toHaveLength(2);
    expect(rest).toEqual([]);
  });
});

describe('mínimo de artistas', () => {
  it(`o mínimo aprovado é ${MIN_ARTISTS}`, () => {
    expect(MIN_ARTISTS).toBe(3);
  });

  it.each([
    [0, 3],
    [1, 2],
    [2, 1],
    [3, 0],
    [7, 0],
  ])('com %i escolhidos, faltam %i', (selected, missing) => {
    expect(missingArtists(selected)).toBe(missing);
  });

  it.each([
    [0, 'Escolha mais 3 artistas'],
    [1, 'Escolha mais 2 artistas'],
    [2, 'Escolha mais 1 artista'],
    [3, 'Continuar com 3 artistas'],
    [5, 'Continuar com 5 artistas'],
  ])('com %i escolhidos, o botão diz "%s"', (selected, label) => {
    expect(continueLabel(selected)).toBe(label);
  });

  it.each([
    [6, 3],
    [3, 3],
    [2, 2],
    [1, 1],
    [0, 0],
  ])(
    'com %i centrais publicadas, o mínimo é %i (nunca mais do que o fã pode escolher)',
    (available, min) => {
      expect(minimumArtists(available)).toBe(min);
    },
  );

  it('com o mínimo menor, o botão acompanha: 2 publicadas pedem 2, e 1 escolhida de 1 continua no singular', () => {
    expect(continueLabel(1, 2)).toBe('Escolha mais 1 artista');
    expect(continueLabel(2, 2)).toBe('Continuar com 2 artistas');
    expect(continueLabel(1, 1)).toBe('Continuar com 1 artista');
    expect(missingArtists(1, minimumArtists(1))).toBe(0);
  });

  it('a dica do botão travado acompanha o mínimo, no singular com uma central só', () => {
    expect(needMoreHint()).toBe('Escolha pelo menos 3 artistas.');
    expect(needMoreHint(2)).toBe('Escolha pelo menos 2 artistas.');
    expect(needMoreHint(1)).toBe('Escolha pelo menos 1 artista.');
  });

  it('os rótulos vêm das traduções', () => {
    expect(continueLabel(2)).toBe(t('onboarding.chooseArtists.needMoreOne'));
    expect(continueLabel(0)).toBe(t('onboarding.chooseArtists.needMore', { count: 3 }));
    expect(continueLabel(4)).toBe(t('onboarding.chooseArtists.continue', { count: 4 }));
  });
});
