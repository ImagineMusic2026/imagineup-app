import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';

import { colors } from '@/theme';

import { FanClubPostAuthor, postAuthorLabel } from '../components/post-author';
import type { FanClubPerson } from '../types';

// O topo do card da publicação (03/11/2026, a pedido do dono), no estilo do
// X: o avatar, o nome, o selo do oficial, o @ e o horário numa linha; na
// Início (o `stacked`, 37.19), o @ e o horário na linha de baixo do nome.

// O Jest abre com a fonte do sistema a 200%; a linha só não quebra na fonte padrão.
const window = Dimensions.get('window');
const setFontScale = (fontScale: number) => Dimensions.set({ window: { ...window, fontScale } });

afterEach(() => act(() => setFontScale(window.fontScale)));

// O selo é decorativo e fica fora do leitor: só aparece pedindo os escondidos.
const hiddenOk = { includeHiddenElements: true } as const;

const NOW = new Date(2026, 10, 3, 16, 51);
const HOUR = 3_600_000;
const THALITA: FanClubPerson = {
  uid: 'fa-thalita',
  name: 'Thalita Santos',
  username: 'thalitasan',
  photoURL: null,
};

const postBy = (author: FanClubPerson, publishedAt = new Date(NOW.getTime() - 3 * HOUR)) => ({
  author,
  publishedAt: publishedAt.toISOString(),
});

describe('FanClubPostAuthor', () => {
  it('numa linha só, o nome em negrito, o @ em cor secundária e o " · 3 h" do primeiro dia', () => {
    setFontScale(1);
    const onOpen = jest.fn();
    render(
      <FanClubPostAuthor
        post={postBy(THALITA)}
        now={NOW}
        official={false}
        onOpen={onOpen}
        testID="author"
      />,
    );

    const author = screen.getByRole('link', { name: 'Thalita Santos, @thalitasan' });
    expect(author).toHaveProp('accessibilityHint', 'Abre o perfil de Thalita Santos');
    expect(within(author).getByText('Thalita Santos')).toHaveProp('numberOfLines', 1);
    const handle = within(author).getByText('@thalitasan');
    expect(handle).toHaveProp('numberOfLines', 1);
    expect(handle).toHaveStyle({ color: colors.textMuted });
    expect(within(author).getByText('· 3 h')).toHaveStyle({ color: colors.textMuted });
    expect(screen.queryByTestId('author-official', hiddenOk)).not.toBeOnTheScreen();

    fireEvent.press(author);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('passadas 24 h, o horário vira a data', () => {
    const published = new Date(2026, 10, 2, 12);
    render(<FanClubPostAuthor post={postBy(THALITA, published)} now={NOW} official={false} />);
    expect(screen.getByText('· 2 de nov')).toBeTruthy();
  });

  it('com o oficial, o selo vai ao lado do nome, e o leitor ouve o que ele diz', () => {
    render(
      <FanClubPostAuthor
        post={postBy(THALITA)}
        now={NOW}
        official
        onOpen={jest.fn()}
        testID="author"
      />,
    );
    expect(screen.getByTestId('author-official', hiddenOk)).toBeTruthy();
    expect(
      screen.getByRole('link', {
        name: 'Thalita Santos, @thalitasan, gestor do fã-clube oficial',
      }),
    ).toBeTruthy();
  });

  it('sem o nome, o @ fica no lugar dele, uma vez; sem nenhum dos dois, "Fã"', () => {
    const noName = { ...THALITA, name: null };
    const { rerender } = render(
      <FanClubPostAuthor post={postBy(noName)} now={NOW} official={false} />,
    );
    expect(screen.getAllByText('@thalitasan')).toHaveLength(1);
    expect(postAuthorLabel(noName, false)).toBe('@thalitasan');

    rerender(
      <FanClubPostAuthor post={postBy({ ...noName, username: null })} now={NOW} official={false} />,
    );
    expect(screen.getByText('Fã')).toBeTruthy();
  });

  it('sem o onOpen (a própria publicação), o autor só se lê, com o mesmo rótulo', () => {
    render(<FanClubPostAuthor post={postBy(THALITA)} now={NOW} official={false} testID="author" />);
    expect(screen.queryByRole('link')).not.toBeOnTheScreen();
    const author = screen.getByTestId('author');
    expect(author).toHaveProp('accessible', true);
    expect(author).toHaveProp('accessibilityLabel', 'Thalita Santos, @thalitasan');
  });

  it('com a fonte grande, o nome não corta, e o @ e o horário descem para baixo dele', () => {
    setFontScale(1.5);
    render(<FanClubPostAuthor post={postBy(THALITA)} now={NOW} official={false} testID="author" />);
    expect(screen.getByText('Thalita Santos').props.numberOfLines).toBeUndefined();
    expect(screen.getByText('@thalitasan').props.numberOfLines).toBeUndefined();
    expect(StyleSheet.flatten(screen.getByTestId('author-line').props.style)).toMatchObject({
      flexWrap: 'wrap',
    });
  });

  describe('em duas linhas, na Início (pedido do dono de 03/11/2026, 37.19)', () => {
    it('o nome em cima e, embaixo dele, o @ e o " · 3 h", com o mesmo rótulo', () => {
      setFontScale(1);
      render(
        <FanClubPostAuthor
          post={postBy(THALITA)}
          now={NOW}
          official={false}
          stacked
          onOpen={jest.fn()}
          testID="author"
        />,
      );

      const line = screen.getByTestId('author-line');
      expect(within(line).getByText('Thalita Santos')).toHaveProp('numberOfLines', 1);
      expect(within(line).queryByText('@thalitasan')).not.toBeOnTheScreen();
      const meta = screen.getByTestId('author-meta');
      expect(within(meta).getByText('@thalitasan')).toHaveProp('numberOfLines', 1);
      expect(within(meta).getByText('· 3 h')).toHaveStyle({ color: colors.textMuted });
      expect(screen.getByRole('link', { name: 'Thalita Santos, @thalitasan' })).toBeTruthy();
    });

    it('o selo segue ao lado do nome, na linha de cima', () => {
      render(
        <FanClubPostAuthor post={postBy(THALITA)} now={NOW} official stacked testID="author" />,
      );
      expect(
        within(screen.getByTestId('author-line')).getByTestId('author-official', hiddenOk),
      ).toBeTruthy();
    });

    it('sem o nome, o @ fica em cima, e o horário desce sozinho, sem o ponto', () => {
      render(
        <FanClubPostAuthor
          post={postBy({ ...THALITA, name: null })}
          now={NOW}
          official={false}
          stacked
          testID="author"
        />,
      );
      expect(screen.getAllByText('@thalitasan')).toHaveLength(1);
      expect(within(screen.getByTestId('author-line')).getByText('@thalitasan')).toBeTruthy();
      expect(within(screen.getByTestId('author-meta')).getByText('3 h')).toBeTruthy();
    });
  });
});
