import { QueryClient, QueryClientProvider, type InfiniteData } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';

import { missionKeys } from '@/domains/missions';
import { resetCelebratedMissions, wasMissionCelebrated } from '@/domains/missions/celebrated';
import { profileKeys } from '@/domains/profile/keys';
import { resetCelebratedLevels, wasLevelCelebrated } from '@/domains/profile/level-celebrated';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';

import { addComment, setPostLike, type AddCommentResult } from '../api';
import { postKeys } from '../keys';
import { useAddCommentMutation, useToggleLikeMutation } from '../queries';
import type { Page, PostComment } from '../types';

/**
 * O que curtir e comentar rendem além dos pontos (bloco 7, 22.12): a missão
 * concluída, o nível novo e a conquista vão numa frase só, com o toque do
 * maior; só as missões que andaram buscam de novo; e os campos das
 * recompensas não entram no cache dos comentários.
 */

jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  getDoc: jest.fn(),
  onSnapshot: jest.fn(() => () => undefined),
}));
jest.mock('@/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getDb: () => ({}),
  isFirebaseConfigured: true,
}));
jest.mock('@/services/api', () => ({ api: { get: jest.fn(), request: jest.fn() } }));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'api',
  usesFixtures: () => true,
}));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  setPostLike: jest.fn(),
  addComment: jest.fn(),
}));

const like = jest.mocked(setPostLike);
const comment = jest.mocked(addComment);

const LIKE_MISSION = {
  id: 'm-curtir-nenho',
  title: 'Curta 5 posts do Nenho',
  rewardPoints: 10,
  completedAt: '2026-10-05T22:31:04.000Z',
};
const COMMENT_MISSION = {
  id: 'm-comentar-central',
  title: 'Comente em 3 posts da central',
  rewardPoints: 20,
  completedAt: '2026-10-05T22:40:00.000Z',
};
const XODO = { number: 8, name: 'Xodó', minXp: 15_000 };
const FIRST_LIKE = { id: 'primeira-curtida', title: 'Primeira curtida' };

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Consultas que a recompensa pode mandar buscar de novo, já no cache. */
function seedQueries(): void {
  client.setQueryData(missionKeys.list(), { season: null, missions: [] });
  client.setQueryData(profileKeys.achievements(), {
    unlockedCount: 0,
    totalCount: 10,
    highlights: [],
  });
  client.setQueryData(profileKeys.wallet(), { balance: 0, xp: 0, seasonPoints: 0 });
}

const invalidated = (queryKey: readonly unknown[]) =>
  client.getQueryState(queryKey)?.isInvalidated ?? false;

beforeEach(() => {
  jest.clearAllMocks();
  // Sem o prazo de 5 min das mutações, que segurava o Jest aberto depois dos testes.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  useSessionStore.setState({
    status: 'signedIn',
    user: {
      uid: 'uid-camila',
      email: 'camila@teste.imagineup',
      displayName: 'Camila Ribeiro',
      photoURL: null,
    },
    authHolds: 0,
  });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
  seedQueries();
});

afterEach(() => {
  client.clear();
  resetCelebratedMissions();
  resetCelebratedLevels();
  jest.restoreAllMocks();
});

describe('curtir', () => {
  it('a curtida que conclui a missão e sobe o nível festeja tudo no "+N", uma vez', async () => {
    like.mockResolvedValue({
      pointsAwarded: 10,
      completedMissions: [LIKE_MISSION],
      levelUp: XODO,
      unlockedAchievements: [],
      missionsChanged: true,
    });
    const { result } = renderHook(() => useToggleLikeMutation(), { wrapper });

    act(() => result.current.toggle('p-nenho-1', true));

    await waitFor(() =>
      expect(result.current.award).toMatchObject({
        points: 10,
        announcement:
          'Mais 10 pontos. Missão concluída: Curta 5 posts do Nenho. Você subiu para o nível 8, Xodó.',
        haptic: 'levelUp',
      }),
    );
    // A 1g, a home e a 1e não repetem o toque nem o anúncio.
    expect(wasMissionCelebrated(LIKE_MISSION.id, LIKE_MISSION.completedAt)).toBe(true);
    expect(wasLevelCelebrated('uid-camila', XODO.number)).toBe(true);
    expect(invalidated(missionKeys.list())).toBe(true);
    expect(invalidated(profileKeys.achievements())).toBe(true);
    expect(invalidated(profileKeys.wallet())).toBe(true);
  });

  it('a conquista sem pontos (curtir valendo 0) só anuncia, sem "+N" e sem mexer na carteira', async () => {
    like.mockResolvedValue({
      pointsAwarded: 0,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [FIRST_LIKE],
      missionsChanged: true,
    });
    const { result } = renderHook(() => useToggleLikeMutation(), { wrapper });

    act(() => result.current.toggle('p-nenho-1', true));

    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
        'Conquista nova: Primeira curtida.',
        { queue: true },
      ),
    );
    expect(result.current.award).toBeNull();
    expect(invalidated(profileKeys.achievements())).toBe(true);
    expect(invalidated(missionKeys.list())).toBe(true);
    expect(invalidated(profileKeys.wallet())).toBe(false);
  });

  it('sem missão que andou (missionsChanged: false), as missões não buscam de novo', async () => {
    like.mockResolvedValue({
      pointsAwarded: 0,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: false,
    });
    const { result } = renderHook(() => useToggleLikeMutation(), { wrapper });

    act(() => result.current.toggle('p-netto-9', true));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidated(missionKeys.list())).toBe(false);
    expect(invalidated(profileKeys.achievements())).toBe(false);
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).not.toHaveBeenCalled();
  });
});

describe('comentar', () => {
  it('o comentário que conclui a missão entra na lista sem os campos das recompensas', async () => {
    client.setQueryData<InfiniteData<Page<PostComment>>>(postKeys.comments('p-clipe'), {
      pages: [{ items: [], nextCursor: null }],
      pageParams: [null],
    });
    const saved: AddCommentResult = {
      id: 'c-novo',
      postId: 'p-clipe',
      authorId: 'uid-camila',
      authorName: 'Camila Ribeiro',
      authorAvatarUrl: null,
      authorIsArtist: false,
      text: 'Que clipe!',
      createdAt: '2026-10-05T22:40:00.000Z',
      pointsAwarded: 22,
      completedMissions: [COMMENT_MISSION],
      levelUp: null,
      unlockedAchievements: [],
      missionsChanged: true,
    };
    comment.mockResolvedValue(saved);
    const { result } = renderHook(() => useAddCommentMutation('p-clipe'), { wrapper });

    act(() => {
      result.current.send('Que clipe!');
    });

    await waitFor(() =>
      expect(result.current.award).toMatchObject({
        points: 22,
        rewards: 'Mais 22 pontos. Missão concluída: Comente em 3 posts da central.',
        haptic: 'missionComplete',
      }),
    );
    const list = client.getQueryData<InfiniteData<Page<PostComment>>>(postKeys.comments('p-clipe'));
    const [first] = list?.pages[0]?.items ?? [];
    expect(first?.id).toBe('c-novo');
    for (const field of [
      'pointsAwarded',
      'completedMissions',
      'levelUp',
      'unlockedAchievements',
      'missionsChanged',
    ]) {
      expect(first).not.toHaveProperty(field);
    }
    expect(wasMissionCelebrated(COMMENT_MISSION.id, COMMENT_MISSION.completedAt)).toBe(true);
    expect(invalidated(missionKeys.list())).toBe(true);
  });

  it('sem pontos e com conquista, a frase vai junto do "Comentário enviado."', async () => {
    comment.mockResolvedValue({
      id: 'c-outro',
      postId: 'p-clipe',
      authorId: 'uid-camila',
      authorName: 'Camila Ribeiro',
      authorAvatarUrl: null,
      authorIsArtist: false,
      text: 'Bora',
      createdAt: '2026-10-05T22:41:00.000Z',
      pointsAwarded: 0,
      completedMissions: [],
      levelUp: null,
      unlockedAchievements: [{ id: 'primeiro-comentario', title: 'Primeiro comentário' }],
      missionsChanged: false,
    });
    const { result } = renderHook(() => useAddCommentMutation('p-clipe'), { wrapper });

    act(() => {
      result.current.send('Bora');
    });

    await waitFor(() =>
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        'Comentário enviado. Conquista nova: Primeiro comentário.',
      ),
    );
    expect(result.current.award).toBeNull();
    expect(invalidated(missionKeys.list())).toBe(false);
    expect(invalidated(profileKeys.achievements())).toBe(true);
  });
});
