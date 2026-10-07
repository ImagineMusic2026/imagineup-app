import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { AccessibilityInfo, StyleSheet } from 'react-native';

import type { ArtistDetails } from '@/domains/artists';
import { buildPostsFixture } from '@/domains/posts/fixtures';
import type { LeaderboardEntry } from '@/domains/ranking';
import { layout } from '@/theme';

import { ArtistActions } from '../components/artist-actions';
import { PostGridRow } from '../components/post-grid-row';
import { TopFansCard } from '../components/top-fans-card';

// Os índices dos domínios puxam telas com Firebase, que o Jest não roda (ESM).
jest.mock('firebase/app', () => ({ FirebaseError: class FirebaseError extends Error {} }));
jest.mock('firebase/auth', () => ({}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('@/firebase', () => ({ getFirebaseAuth: () => ({}), getDb: () => ({}) }));
jest.mock('@/services/api', () => ({ api: { get: jest.fn() } }));
jest.mock('@/config/env', () => ({
  firebaseEnv: null,
  apiUrl: undefined,
  firebaseEmulatorHost: undefined,
}));
jest.mock('@/config/data-source', () => ({
  sourceOf: () => 'fixtures',
  usesFixtures: () => true,
}));

// Relógio fixo: terça, 29 de setembro de 2026, 20 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const hidden = { includeHiddenElements: true } as const;
const self = { id: 'uid-camila', name: 'Camila Ribeiro', photoUrl: null };

function entry(position: number, overrides: Partial<LeaderboardEntry> = {}): LeaderboardEntry {
  return {
    position,
    userId: `fa-${position}`,
    displayName: ['Thalita Santos', 'Davi Lima', 'Jean Pereira'][position - 1] ?? 'Fã',
    photoURL: null,
    city: null,
    points: 10_000 - position * 1_000,
    change: 0,
    isMe: false,
    ...overrides,
  };
}

const ROCK: ArtistDetails = {
  id: 'rocksalles',
  name: 'Rock Salles',
  coverUrl: null,
  photoURL: null,
  verified: true,
  managedByImagine: true,
  fanCount: 96_000,
  postCount: 268,
  centralPoints: 1_100_000,
  isMember: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(router, 'push').mockImplementation(() => undefined);
});

describe('TopFansCard', () => {
  it('cada lugar é um elemento só, com o nome curto e os pontos por extenso', () => {
    render(
      <TopFansCard
        entries={[entry(1), entry(2), entry(3)]}
        state="ready"
        self={self}
        onSeeRanking={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('1º lugar, Thalita S., 9.000 pontos')).toBeTruthy();
    expect(screen.getByLabelText('2º lugar, Davi L., 8.000 pontos')).toBeTruthy();
    expect(screen.getByLabelText('3º lugar, Jean P., 7.000 pontos')).toBeTruthy();
    // O título é "da temporada", como os números: o protótipo dizia "da semana".
    expect(screen.getByLabelText('Top fãs da temporada')).toBeTruthy();
  });

  it('o fã no top 3 ouve "você" no lugar do nome', () => {
    render(
      <TopFansCard
        entries={[entry(1), entry(2, { isMe: true, displayName: null })]}
        state="ready"
        self={self}
        onSeeRanking={jest.fn()}
      />,
    );
    expect(screen.getByLabelText('2º lugar, você, 8.000 pontos')).toBeTruthy();
  });

  it('com menos de três fãs, os lugares que faltam ficam como vaga aberta', () => {
    render(<TopFansCard entries={[entry(1)]} state="ready" self={self} onSeeRanking={jest.fn()} />);
    expect(screen.getByLabelText('2º lugar, vaga aberta')).toBeTruthy();
    expect(screen.getByLabelText('3º lugar, vaga aberta')).toBeTruthy();
  });

  it('carregando, o leitor ouve que os top fãs estão chegando', () => {
    render(<TopFansCard entries={[]} state="loading" self={self} onSeeRanking={jest.fn()} />);
    expect(screen.getByLabelText('Carregando os top fãs')).toBeTruthy();
  });

  it('"Ver ranking" tem alvo de 44 e diz o que faz', () => {
    const onSeeRanking = jest.fn();
    render(
      <TopFansCard entries={[entry(1)]} state="ready" self={self} onSeeRanking={onSeeRanking} />,
    );
    const link = screen.getByLabelText('Ver o ranking da central');
    expect(StyleSheet.flatten(link.props.style).minHeight).toBeGreaterThanOrEqual(
      layout.minTouchTarget,
    );
    expect(link.props.accessibilityHint).toBe('Abre a aba Ranking desta página');
    fireEvent.press(link);
    expect(onSeeRanking).toHaveBeenCalled();
  });
});

describe('PostGridRow', () => {
  const posts = buildPostsFixture(NOW);
  const byId = (id: string) => posts.find((post) => post.id === id)!;

  it('cada célula abre o post e é lida com o autor, a hora e o texto', () => {
    render(<PostGridRow posts={[byId('p-clipe'), byId('p-texto')]} now={NOW} />);
    fireEvent.press(
      screen.getByLabelText(
        'Vídeo de Netto Brito, há 2 horas: Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
      ),
    );
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/post/[postId]',
      params: { postId: 'p-clipe' },
    });
  });

  it('post sem mídia mostra o começo do texto', () => {
    render(<PostGridRow posts={[byId('p-texto')]} now={NOW} />);
    expect(
      screen.getByText('Tem música nova chegando. Chuta o nome aí nos comentários.', hidden),
    ).toBeTruthy();
  });

  it('a última linha incompleta guarda o lugar das células que faltam', () => {
    render(<PostGridRow posts={[byId('p-g1')]} now={NOW} />);
    expect(screen.getByTestId('artist-post-p-g1')).toBeTruthy();
    expect(screen.getAllByTestId('artist-post-slot', hidden)).toHaveLength(2);
  });
});

describe('ArtistActions', () => {
  const actions = { onJoin: jest.fn(), onLeave: jest.fn(), joinPending: false, award: null };

  beforeEach(() => {
    actions.onJoin.mockClear();
    actions.onLeave.mockClear();
  });

  it('fora da central, "Entrar na central" com o nome do artista', () => {
    render(<ArtistActions {...actions} artist={ROCK} />);
    fireEvent.press(screen.getByLabelText('Entrar na central de Rock Salles'));
    expect(actions.onJoin).toHaveBeenCalled();
    expect(actions.onLeave).not.toHaveBeenCalled();
  });

  it('dentro, "Na central" abre a opção de sair (padrão provisório da UP-48)', () => {
    render(<ArtistActions {...actions} artist={{ ...ROCK, isMember: true }} />);
    const button = screen.getByRole('button', { name: 'Você está na central de Rock Salles' });
    expect(button.props.accessibilityHint).toBe('Abre a opção de sair da central');
    fireEvent.press(button);
    expect(actions.onLeave).toHaveBeenCalledTimes(1);
    expect(actions.onJoin).not.toHaveBeenCalled();
  });

  it('com a entrada esperando o servidor, "Na central" é estado: lido como texto, sem toque', () => {
    render(<ArtistActions {...actions} joinPending artist={{ ...ROCK, isMember: true }} />);
    const status = screen.getByLabelText('Você está na central de Rock Salles');
    expect(status.props.accessibilityRole).toBe('text');
    // Sem `focusable`, o Android não o anuncia como tocável.
    expect(status.props.focusable).toBe(false);
    expect(
      screen.queryByRole('button', { name: 'Você está na central de Rock Salles' }),
    ).toBeNull();
    fireEvent.press(status);
    expect(actions.onLeave).not.toHaveBeenCalled();
    expect(actions.onJoin).not.toHaveBeenCalled();
  });

  it('os pontos que a API devolveu sobem num "+N", anunciado uma vez', () => {
    const view = render(<ArtistActions {...actions} artist={ROCK} />);
    view.rerender(
      <ArtistActions
        {...actions}
        joinPending
        artist={{ ...ROCK, isMember: true }}
        award={{ id: 1, points: 10 }}
      />,
    );
    expect(screen.getByTestId('artist-join-points', hidden)).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibilityWithOptions).toHaveBeenCalledWith(
      'Mais 10 pontos',
      { queue: true },
    );
  });

  it('enquanto a central chega, o botão fica em esqueleto, fora do leitor (a capa já avisa)', () => {
    render(<ArtistActions {...actions} artist={undefined} />);
    expect(screen.getByLabelText(/^Carregando/, hidden)).toBeTruthy();
    expect(screen.queryByLabelText(/^Carregando/)).toBeNull();
  });
});
