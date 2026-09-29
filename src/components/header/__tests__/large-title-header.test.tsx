import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Dimensions, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, spacing, typography } from '@/theme';

import { LargeTitleHeader } from '..';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

// O Jest abre com a fonte do sistema a 200%; os vãos com o voltar dependem dela.
const window = Dimensions.get('window');
const setFontScale = (fontScale: number) => Dimensions.set({ window: { ...window, fontScale } });

afterEach(() => act(() => setFontScale(window.fontScale)));

/** Vãos verticais que só o `marginTop` distingue. */
const withMarginTop = (value: number) =>
  screen
    .UNSAFE_getAllByType(View)
    .filter((node) => StyleSheet.flatten(node.props.style)?.marginTop === value);

// Na fonte padrão, a linha com o voltar tem os 44 do alvo, e a entrelinha do
// título (29) sobra 7,5 em cima e embaixo.
const SLACK = (layout.minTouchTarget - typography.titlePage.lineHeight) / 2;

describe('LargeTitleHeader', () => {
  it('o título é header e o subtítulo vem a 9 dele, em branco a .5', () => {
    render(<LargeTitleHeader title="Missões" subtitle="Toda ação vale ponto." />);
    expect(screen.getByRole('header', { name: 'Missões' })).toBeTruthy();
    expect(screen.getByText('Toda ação vale ponto.')).toHaveStyle({
      color: colors.textMuted,
      marginTop: spacing.tileGap,
    });
  });

  it('a linha de baixo fica a 15 do título e o bloco respira 18 até o conteúdo', () => {
    render(
      <LargeTitleHeader title="Agenda">
        <Text>Chips</Text>
      </LargeTitleHeader>,
    );
    const below = withMarginTop(spacing.titleToChips);
    expect(below).toHaveLength(1);
    expect(within(below[0]!).getByText('Chips')).toBeTruthy();
    expect(screen.root).toHaveStyle({ paddingTop: spacing.md, paddingBottom: spacing.blockGap });
  });

  it('sem pedir, não tem voltar', () => {
    render(<LargeTitleHeader title="Ranking" />);
    expect(screen.queryByLabelText(t('common.back'))).toBeNull();
  });

  it('com voltar, ele vem na linha do título e é lido antes dele', () => {
    render(<LargeTitleHeader title="Resgatar" showBack accessory={<View testID="saldo" />} />);
    const order = screen.getAllByRole(/button|header/).map((node) => node.props.accessibilityRole);
    expect(order).toEqual(['button', 'header']);
    expect(screen.getByTestId('saldo')).toBeTruthy();
  });

  it('com voltar, na fonte padrão, o título e o subtítulo ficam onde ficariam sem ele', () => {
    setFontScale(1);
    render(<LargeTitleHeader title="Missões" subtitle="Toda ação vale ponto." showBack />);
    expect(screen.root).toHaveStyle({ paddingTop: spacing.md - SLACK });
    expect(screen.getByText('Toda ação vale ponto.')).toHaveStyle({
      marginTop: spacing.tileGap - SLACK,
    });
  });

  it('com voltar e sem subtítulo, a linha de baixo também desconta a sobra', () => {
    setFontScale(1);
    render(
      <LargeTitleHeader title="Agenda" showBack>
        <Text>Chips</Text>
      </LargeTitleHeader>,
    );
    expect(withMarginTop(spacing.titleToChips - SLACK)).toHaveLength(1);
  });

  it('com voltar e sem nada embaixo do título (1h), o primeiro card fica a 18 do título', () => {
    setFontScale(1);
    render(<LargeTitleHeader title="Resgatar" showBack accessory={<View testID="saldo" />} />);
    expect(screen.root).toHaveStyle({
      paddingTop: spacing.md - SLACK,
      paddingBottom: spacing.blockGap - SLACK,
    });
  });

  it('com voltar e subtítulo, a sobra sai do vão do subtítulo, e o pé fica em 18', () => {
    setFontScale(1);
    render(<LargeTitleHeader title="Missões" subtitle="Toda ação vale ponto." showBack />);
    expect(screen.root).toHaveStyle({ paddingBottom: spacing.blockGap });
  });

  it('com voltar e a fonte grande, o título passa dos 44 e nada é descontado', () => {
    setFontScale(2);
    render(<LargeTitleHeader title="Missões" subtitle="Toda ação vale ponto." showBack />);
    expect(screen.root).toHaveStyle({ paddingTop: spacing.md });
    expect(screen.getByText('Toda ação vale ponto.')).toHaveStyle({ marginTop: spacing.tileGap });
  });

  it('a peça à direita desce para uma linha própria quando o título quebra ao lado dela', () => {
    render(<LargeTitleHeader title="Resgatar" showBack accessory={<View testID="saldo" />} />);
    const title = screen.getByRole('header', { name: 'Resgatar' });
    const ownLine = () =>
      screen
        .UNSAFE_getAllByType(View)
        .filter((node) => StyleSheet.flatten(node.props.style)?.alignSelf === 'flex-end');

    // Uma linha: fica ao lado.
    fireEvent(title, 'textLayout', { nativeEvent: { lines: [{ text: 'Resgatar' }] } });
    expect(ownLine()).toHaveLength(0);
    expect(screen.getByTestId('saldo')).toBeTruthy();

    // "Resgat" / "ar": a pílula desce para a linha dela, à direita.
    fireEvent(title, 'textLayout', {
      nativeEvent: { lines: [{ text: 'Resgat' }, { text: 'ar' }] },
    });
    expect(ownLine()).toHaveLength(1);
    expect(within(ownLine()[0]!).getByTestId('saldo')).toBeTruthy();
    expect(screen.getAllByTestId('saldo')).toHaveLength(1);
  });

  it('com a peça embaixo, o pé volta a 18: o título não é mais o último', () => {
    setFontScale(1);
    render(<LargeTitleHeader title="Resgatar" showBack accessory={<View testID="saldo" />} />);
    const title = screen.getByRole('header', { name: 'Resgatar' });
    fireEvent(title, 'textLayout', { nativeEvent: { lines: [{}, {}] } });
    expect(screen.root).toHaveStyle({ paddingBottom: spacing.blockGap });
  });

  it('o voltar usa a ação da tela quando ela passa uma', () => {
    const onBack = jest.fn();
    render(<LargeTitleHeader title="Missões" showBack onBack={onBack} />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(onBack).toHaveBeenCalled();
  });
});
