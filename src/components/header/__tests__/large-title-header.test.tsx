import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';

import { LargeTitleHeader } from '..';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

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
    const below = screen
      .UNSAFE_getAllByType(View)
      .filter((node) => StyleSheet.flatten(node.props.style)?.marginTop === spacing.titleToChips);
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

  it('com voltar, o topo desconta a folga do alvo para o círculo ficar onde o título começaria', () => {
    render(<LargeTitleHeader title="Missões" showBack />);
    const slack = (layout.minTouchTarget - layout.headerButtonSize) / 2;
    expect(screen.root).toHaveStyle({ paddingTop: spacing.md - slack });
  });

  it('o voltar usa a ação da tela quando ela passa uma', () => {
    const onBack = jest.fn();
    render(<LargeTitleHeader title="Missões" showBack onBack={onBack} />);
    fireEvent.press(screen.getByLabelText(t('common.back')));
    expect(onBack).toHaveBeenCalled();
  });
});
