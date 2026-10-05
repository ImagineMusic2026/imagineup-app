import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Dimensions, Share } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { pillMinHeight } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import { agendaKeys, RsvpChip } from '@/domains/agenda';
import { profileKeys } from '@/domains/profile';
import { buildMyInviteFixture } from '@/domains/profile/fixtures';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout } from '@/theme';

import { CommentRow } from '../components/comment-row';
import { PostActions } from '../components/post-actions';
import { focusedTab, PostAuthorRow } from '../components/post-author-row';
import { mediaAspectRatio, PostContent } from '../components/post-content';
import { buildPostsFixture } from '../fixtures';
import type { Post, PostComment } from '../types';

// O convite do fã (compartilhar) vem do domínio de perfil, que lê o Firestore.
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

const mockRootState = { current: undefined as unknown };
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn(), dismissTo: jest.fn() },
  useNavigationContainerRef: () => ({ getRootState: () => mockRootState.current }),
}));

const hidden = { includeHiddenElements: true } as const;

// A fonte do sistema (o mock do React Native começa em 2), trocada nos testes de texto grande.
const systemWindow = Dimensions.get('window');
const setFontScale = (fontScale: number) =>
  Dimensions.set({ window: { ...systemWindow, fontScale } });

// Terça, 29 de setembro de 2026, 20 h: o clipe é das 18 h.
const NOW = new Date(2026, 8, 29, 20, 0);
const [CLIP, SHOW] = buildPostsFixture(NOW) as [Post, Post];

const comment = (overrides: Partial<PostComment> = {}): PostComment => ({
  id: 'c-thalita',
  postId: 'p-clipe',
  authorId: 'fa-thalita',
  authorName: 'Thalita S.',
  authorAvatarUrl: null,
  authorIsArtist: false,
  text: 'Irará em peso!',
  createdAt: new Date(NOW.getTime() - 60 * 60_000).toISOString(),
  ...overrides,
});

let client: QueryClient;

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Pressáveis que moram dentro de outro pressável (a regra do workspace proíbe). */
function nestedPressables(): ReactTestInstance[] {
  const pressables = screen.UNSAFE_queryAllByType(PressableScale);
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
  mockRootState.current = undefined;
  // gcTime infinito também nas mutações: o compartilhar conta o link
  // (useRegisterInviteLinkMutation), e o timer de limpeza seguraria o Jest.
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  client.setQueryData(profileKeys.invite(), buildMyInviteFixture());
  client.setQueryData(agendaKeys.rsvps(), { eventIds: [] });
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => setFontScale(systemWindow.fontScale));
  client.clear();
  jest.restoreAllMocks();
});

describe('CommentRow', () => {
  it('a linha é um elemento só: nome, hora por extenso e o texto', () => {
    render(<CommentRow comment={comment()} now={NOW} />);
    expect(screen.getByLabelText('Thalita S., há 1 hora: Irará em peso!')).toBeTruthy();
    expect(screen.getByText('· 1 h')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a resposta do artista leva o selo e é lida como artista verificado', () => {
    render(
      <CommentRow
        comment={comment({
          authorId: 'nettobrito',
          authorName: 'Netto Brito',
          authorIsArtist: true,
          createdAt: new Date(NOW.getTime() - 48 * 60_000).toISOString(),
        })}
        now={NOW}
      />,
    );
    expect(
      screen.getByLabelText('Netto Brito, artista verificado, há 48 minutos: Irará em peso!'),
    ).toBeTruthy();
  });

  it('o do fã que ainda vai diz "enviando…" e não é tocável', () => {
    const onRetry = jest.fn();
    render(<CommentRow comment={comment({ status: 'pending' })} now={NOW} onRetry={onRetry} />);
    const row = screen.getByLabelText('Thalita S., enviando: Irará em peso!');
    expect(screen.getByText(t('post.comments.sending'), hidden)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // Sem o clique do Android: o TalkBack não oferece um toque que não faz nada.
    expect(row.props.focusable).toBe(false);
    fireEvent.press(row);
    expect(onRetry).not.toHaveBeenCalled();
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o que falhou diz "Não enviado" e o toque tenta de novo', () => {
    const onRetry = jest.fn();
    render(<CommentRow comment={comment({ status: 'failed' })} now={NOW} onRetry={onRetry} />);
    const row = screen.getByRole('button', { name: 'Thalita S., não enviado: Irará em peso!' });
    expect(row.props.accessibilityHint).toBe(t('post.comments.retryHint'));
    expect(row.props.focusable).toBe(true);
    expect(screen.getByText(t('post.comments.failed'), hidden)).toBeTruthy();
    expect(row).toHaveStyle({ minHeight: layout.minTouchTarget });
    fireEvent.press(row);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('enviando, "Não enviado" e gravado são o mesmo elemento, e o foco do leitor fica nele', () => {
    const view = render(<CommentRow comment={comment({ status: 'failed' })} now={NOW} />);
    const row = screen.getByTestId('comment-c-thalita');
    view.rerender(<CommentRow comment={comment({ status: 'pending' })} now={NOW} />);
    expect(screen.getByTestId('comment-c-thalita')).toBe(row);
    view.rerender(<CommentRow comment={comment()} now={NOW} />);
    expect(screen.getByTestId('comment-c-thalita')).toBe(row);
  });

  it('o do próprio fã diz "Você", com as iniciais dele no avatar', () => {
    render(
      <CommentRow
        comment={comment({ authorId: 'uid-camila', authorName: 'Camila Ribeiro' })}
        now={NOW}
        mine
      />,
    );
    expect(screen.getByLabelText('Você, há 1 hora: Irará em peso!')).toBeTruthy();
    expect(screen.getByText('Você', hidden)).toBeTruthy();
    expect(screen.getByText('CR', hidden)).toBeTruthy();
    expect(screen.queryByText('Camila Ribeiro', hidden)).toBeNull();
  });

  it('com a fonte grande, o nome não corta e a hora desce para baixo dele', () => {
    const name = 'Maria Clara de Souza Albuquerque Nogueira';
    setFontScale(1);
    render(<CommentRow comment={comment({ authorName: name })} now={NOW} />);
    expect(screen.getByText(name, hidden).props.numberOfLines).toBe(1);

    setFontScale(1.3);
    render(<CommentRow comment={comment({ authorName: name })} now={NOW} />);
    const large = screen.getByText(name, hidden);
    expect(large.props.numberOfLines).toBeUndefined();
    let head = large.parent;
    // O primeiro elemento nativo acima do nome: a linha do nome e da hora.
    while (head && typeof head.type !== 'string') head = head.parent;
    expect(head).toHaveStyle({ flexWrap: 'wrap' });
  });
});

describe('PostAuthorRow', () => {
  it('lê autor, papel e tempo numa frase, e diz que abre a central', () => {
    setFontScale(1);
    render(<PostAuthorRow post={CLIP} now={NOW} />);
    const row = screen.getByRole('button', {
      name: 'Netto Brito, artista verificado, Artista Imagine, há 2 horas',
    });
    expect(row.props.accessibilityHint).toBe(t('post.details.authorHint'));
    expect(screen.getByText('Artista Imagine · há 2 h')).toBeTruthy();
    expect(screen.getByText('Netto Brito', hidden).props.numberOfLines).toBe(1);
  });

  it('com a fonte grande, nome e meta quebram em linhas em vez de cortar', () => {
    setFontScale(1.3);
    render(<PostAuthorRow post={CLIP} now={NOW} />);
    expect(screen.getByText('Netto Brito', hidden).props.numberOfLines).toBeUndefined();
    expect(
      screen.getByText('Artista Imagine · há 2 h', hidden).props.numberOfLines,
    ).toBeUndefined();
  });

  it('sem aba debaixo do post (link a frio), a central abre no Início', () => {
    render(<PostAuthorRow post={CLIP} now={NOW} />);
    fireEvent.press(screen.getByRole('button'));
    // Fecha o post e abre na aba que já existe, sem empilhar outra árvore de abas.
    expect(router.dismissTo).toHaveBeenCalledWith(
      { pathname: '/(tabs)/(inicio)/artista/[artistaId]', params: { artistaId: 'nettobrito' } },
      { withAnchor: true },
    );
  });

  it('a central abre na aba de onde o fã veio', () => {
    mockRootState.current = {
      routes: [
        {
          name: '__root',
          state: {
            index: 1,
            routes: [
              {
                name: '(tabs)',
                state: {
                  index: 3,
                  routes: [
                    { name: '(inicio)' },
                    { name: '(explorar)' },
                    { name: '(ranking)' },
                    { name: '(perfil)' },
                  ],
                },
              },
              { name: 'post/[postId]' },
            ],
          },
        },
      ],
    };
    render(<PostAuthorRow post={CLIP} now={NOW} />);
    fireEvent.press(screen.getByRole('button'));
    expect(router.dismissTo).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/(tabs)/(perfil)/artista/[artistaId]' }),
      { withAnchor: true },
    );
  });

  it.each([
    [undefined, null],
    [{ routes: [{ name: 'post/[postId]' }] }, null],
    [{ routes: [{ name: '(tabs)', state: { routes: [{ name: '(ranking)' }] } }] }, '(ranking)'],
  ])('acha a aba em foco na árvore de navegação (%#)', (state, expected) => {
    expect(focusedTab(state)).toBe(expected);
  });
});

describe('PostContent', () => {
  it('post de vídeo mostra a miniatura, lida como vídeo, com a marca no canto e sem botão de tocar', () => {
    render(<PostContent post={CLIP} />);
    expect(screen.getByLabelText('Vídeo do post de Netto Brito')).toBeTruthy();
    expect(screen.getByText(CLIP.text)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('post de show mostra o show, lido por extenso', () => {
    render(<PostContent post={SHOW} />);
    expect(
      screen.getByLabelText('Show Arrocha na Praia, 3 de outubro, 22 horas, Aracaju, SE'),
    ).toBeTruthy();
    expect(screen.getByText('3 out · 22 h · Aracaju, SE', hidden)).toBeTruthy();
  });

  it.each([
    [{ width: 1920, height: 1080 }, 16 / 9],
    [{ width: 1080, height: 1350 }, 4 / 5],
    [{ width: 3000, height: 1000 }, 16 / 9],
    [{ width: 1000, height: 3000 }, 4 / 5],
    [{ width: 1000, height: 1000 }, 1],
    [{ width: null, height: null }, 402 / 236],
    [{ width: 0, height: 1080 }, 402 / 236],
  ])('a proporção da mídia %j fica em %d', (size, expected) => {
    expect(mediaAspectRatio(size)).toBeCloseTo(expected);
  });
});

describe('PostActions', () => {
  const renderActions = (post: Post, onToggleLike = jest.fn(), onComment = jest.fn()) => {
    render(<PostActions post={post} onToggleLike={onToggleLike} onComment={onComment} />, {
      wrapper,
    });
    return { onToggleLike, onComment };
  };

  it('curtir é um estado ligado, com a contagem por extenso', () => {
    const { onToggleLike } = renderActions(CLIP);
    const like = screen.getByRole('button', { name: 'Curtir, 4.812 curtidas' });
    expect(like.props.accessibilityState).toMatchObject({ selected: false });
    expect(like).toHaveStyle({ minHeight: layout.minTouchTarget });
    // Número a .8 do branco, como no card completo da 1a; curtido, branco cheio.
    expect(screen.getByText('4.812', hidden)).toHaveStyle({ color: 'rgba(255, 255, 255, 0.8)' });
    fireEvent.press(like);
    expect(onToggleLike).toHaveBeenCalledTimes(1);
    // Curtir vibra pela mutação (`like`), não pelo toque comum.
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('curtido, fica ligado e o toque que descurte vibra o toque comum', () => {
    renderActions({ ...CLIP, likedByMe: true, likeCount: 4_813 });
    const like = screen.getByRole('button', { name: 'Curtir, 4.813 curtidas' });
    expect(like.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByText('4.813', hidden)).toHaveStyle({ color: colors.text });
    fireEvent.press(like);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('comentar leva ao campo', () => {
    const { onComment } = renderActions(CLIP);
    fireEvent.press(screen.getByRole('button', { name: 'Comentar, 327 comentários' }));
    expect(onComment).toHaveBeenCalledTimes(1);
  });

  it('"Compartilhar +2" diz o que rende e compartilha o link do post com o código do fã', () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    renderActions(CLIP);
    expect(screen.getByText('Compartilhar +2')).toBeTruthy();
    fireEvent.press(
      screen.getByRole('button', {
        name: 'Compartilhar o post, ganha 2 pontos por pessoa que abre o link no app',
      }),
    );
    expect(JSON.stringify(share.mock.calls[0])).toContain('/post/p-clipe?ref=CAMILA12');
  });

  it('sem pontos de compartilhar nas regras, só "Compartilhar"', () => {
    renderActions({ ...CLIP, sharePointsPerVisit: null });
    expect(screen.getByRole('button', { name: 'Compartilhar o post' })).toBeTruthy();
    expect(screen.queryByText(/\+\d/)).toBeNull();
  });

  it('post de show leva o "Eu vou" da agenda no lugar do compartilhar, na altura das pílulas', async () => {
    renderActions(SHOW);
    expect(await screen.findByRole('button', { name: 'Eu vou, Arrocha na Praia' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Compartilhar/ })).toBeNull();
    expect(screen.UNSAFE_getByType(RsvpChip).props.size).toBe('md');
    expect(pillMinHeight.md).toBe(33);
  });

  it('sem pressável dentro de pressável', () => {
    renderActions(CLIP);
    expect(nestedPressables()).toEqual([]);
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });
});
