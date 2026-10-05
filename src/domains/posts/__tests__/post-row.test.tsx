import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Share } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { PressableScale } from '@/components/pressable-scale';
import { agendaKeys } from '@/domains/agenda';
import { rsvpFixture } from '@/domains/agenda/fixtures';
import { missionsFixture } from '@/domains/missions';
import { profileKeys } from '@/domains/profile';
import { buildMyInviteFixture } from '@/domains/profile/fixtures';

import { PostRow } from '../components/post-row';
import { buildPostsFixture } from '../fixtures';
import type { Post } from '../types';

// O build do Firebase que o Jest resolve é ESM. A linha não fala com ele, mas o
// convite do fã vem do domínio de perfil, que lê o Firestore.
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// Só a navegação imperativa sai do ar; o resto (tema de navegação) é o de verdade.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const hidden = { includeHiddenElements: true } as const;

// Os posts de exemplo com o relógio 2 h depois do clipe.
const NOW = new Date();
const [CLIP, SHOW, , , , TEXT] = buildPostsFixture(NOW) as [Post, Post, Post, Post, Post, Post];

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pressáveis que moram dentro de outro pressável (a regra do workspace proíbe). */
function nestedPressables(): ReactTestInstance[] {
  const pressables = screen.UNSAFE_getAllByType(PressableScale);
  return pressables.filter((pressable) => {
    let parent = pressable.parent;
    while (parent) {
      if (pressables.includes(parent)) return true;
      parent = parent.parent;
    }
    return false;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  rsvpFixture.reset();
  missionsFixture.reset();
  // gcTime infinito também nas mutações: o compartilhar conta o link
  // (useRegisterInviteLinkMutation), e o timer de limpeza seguraria o Jest.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  // O convite do fã e as presenças já no cache, como depois da primeira carga.
  client.setQueryData(profileKeys.invite(), buildMyInviteFixture());
  client.setQueryData(agendaKeys.rsvps(), { eventIds: [] });
});

afterEach(() => {
  client.clear();
  jest.restoreAllMocks();
});

describe('PostRow', () => {
  it('o bloco de texto é lido inteiro: autor verificado, tempo por extenso e o texto', () => {
    render(<PostRow post={CLIP} />, { wrapper });
    expect(
      screen.getByRole('button', {
        name: `Netto Brito, artista verificado, há 2 horas. ${CLIP.text}`,
      }),
    ).toBeTruthy();
    expect(screen.getByText('· 2 h')).toBeTruthy();
  });

  it('sem pressável dentro de pressável: miniatura oculta do leitor, pílulas irmãs', () => {
    render(<PostRow post={CLIP} />, { wrapper });
    expect(nestedPressables()).toEqual([]);
    // Para o leitor: o bloco de texto e o compartilhar; a miniatura repete o bloco e some.
    expect(screen.getAllByRole('button')).toHaveLength(2);
    const [thumbnail] = screen.UNSAFE_getAllByType(PressableScale);
    expect(thumbnail?.props).toMatchObject({
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
      accessibilityElementsHidden: true,
    });
  });

  it('miniatura e texto abrem o post', () => {
    render(<PostRow post={CLIP} />, { wrapper });
    const [thumbnail, block] = screen.UNSAFE_getAllByType(PressableScale) as [
      ReactTestInstance,
      ReactTestInstance,
    ];
    fireEvent.press(thumbnail);
    fireEvent.press(block);
    expect(router.push).toHaveBeenCalledTimes(2);
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/post/[postId]',
      params: { postId: 'p-clipe' },
    });
  });

  it('"Compartilhar +2" diz o que rende e compartilha com o código do fã', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    render(<PostRow post={CLIP} />, { wrapper });

    // O nome diz de qual post é: no mural, os vários "Compartilhar" não saem iguais.
    const chip = screen.getByRole('button', {
      name: 'Compartilhar o post de Netto Brito, há 2 horas, ganha 2 pontos por pessoa que abre o link no app',
    });
    expect(screen.getByText('Compartilhar +2')).toBeTruthy();
    expect(chip).toHaveStyle({ minHeight: 44 });

    fireEvent.press(chip);
    expect(share).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(share.mock.calls[0])).toContain('/post/p-clipe?ref=CAMILA12');
  });

  it('a contagem de curtidas é texto, lida como "4.812 curtidas"', () => {
    render(<PostRow post={CLIP} />, { wrapper });
    expect(screen.getByLabelText('4.812 curtidas')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '4.812 curtidas' })).toBeNull();
  });

  it.each([null, 0])(
    'sem pontos de compartilhar nas regras (%p), o chip não promete "+N"',
    (points) => {
      render(<PostRow post={{ ...CLIP, sharePointsPerVisit: points }} />, { wrapper });
      expect(
        screen.getByRole('button', { name: 'Compartilhar o post de Netto Brito, há 2 horas' }),
      ).toBeTruthy();
      expect(screen.getByText('Compartilhar')).toBeTruthy();
      expect(screen.queryByText(/\+\d/)).toBeNull();
    },
  );

  it('post de show leva o "Eu vou" da agenda no lugar do compartilhar', async () => {
    render(<PostRow post={SHOW} />, { wrapper });
    expect(await screen.findByRole('button', { name: 'Eu vou, Arrocha na Praia' })).toBeTruthy();
    expect(screen.queryByText(/Compartilhar/)).toBeNull();
    // A miniatura de show é o bloco ciano, fora do leitor.
    expect(screen.queryByText('Show')).toBeNull();
    expect(screen.getByText('Show', hidden)).toBeTruthy();
    expect(nestedPressables()).toEqual([]);
  });

  it('post de texto fica sem miniatura, e o texto ocupa a linha', () => {
    render(<PostRow post={TEXT} />, { wrapper });
    expect(TEXT.kind).toBe('text');
    // Só o bloco de texto e o compartilhar: nenhuma miniatura.
    expect(screen.UNSAFE_getAllByType(PressableScale)).toHaveLength(2);
  });

  it('o bloco que abre o post tem o alvo de 44 mesmo com uma linha de texto', () => {
    render(<PostRow post={{ ...TEXT, text: 'Curto.' }} />, { wrapper });
    const block = screen.getByRole('button', { name: /Curto\.$/ });
    expect(block).toHaveStyle({ minHeight: 44 });
  });
});
