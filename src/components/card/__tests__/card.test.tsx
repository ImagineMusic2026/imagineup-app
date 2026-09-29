import { fireEvent, render, screen } from '@testing-library/react-native';

import { Text } from '@/components/text';
import { colors, radii, spacing, tints } from '@/theme';
import { withAlpha } from '@/utils/color';

import { Card, type CardVariant } from '..';

describe('Card', () => {
  it('sem onPress é só uma superfície: nada tocável', () => {
    render(
      <Card>
        <Text>Semana do arrocha</Text>
      </Card>,
    );

    expect(screen.getByText('Semana do arrocha')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('sem onPress, pode agrupar o conteúdo num foco só', () => {
    render(
      <Card accessible accessibilityLabel="Seus pontos: 12.480" accessibilityRole="summary">
        <Text>12.480</Text>
      </Card>,
    );
    expect(screen.getByRole('summary', { name: 'Seus pontos: 12.480' })).toBeTruthy();
  });

  it('com onPress vira um pressável só, com o rótulo de quem chama', () => {
    const onPress = jest.fn();
    render(
      <Card onPress={onPress} accessibilityLabel="Par de ingressos. 6.000 pontos.">
        <Text>Par de ingressos</Text>
        <Text>6.000 pts</Text>
      </Card>,
    );

    const card = screen.getByRole('button', { name: 'Par de ingressos. 6.000 pontos.' });
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('o papel é de quem chama', () => {
    render(
      <Card onPress={jest.fn()} accessibilityRole="link" accessibilityLabel="Netto Brito">
        <Text>Netto Brito</Text>
      </Card>,
    );
    expect(screen.getByRole('link', { name: 'Netto Brito' })).toBeTruthy();
  });

  it('bloqueado e pressável avisa o estado que quem chama passa', () => {
    render(
      <Card
        variant="locked"
        onPress={jest.fn()}
        haptic="locked"
        accessibilityLabel="Missão relâmpago do show. Bloqueada."
        accessibilityState={{ disabled: true }}
      >
        <Text>Missão relâmpago do show</Text>
      </Card>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it.each<[CardVariant, object]>([
    [
      'default',
      { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.lg },
    ],
    ['large', { borderRadius: radii.xl, paddingVertical: spacing.lg }],
    ['compact', { borderRadius: radii.md, paddingVertical: spacing.tileGap }],
    ['inset', { backgroundColor: colors.background, borderRadius: radii.sm }],
    ['locked', { backgroundColor: colors.surface, borderColor: colors.borderSubtle }],
    [
      'dashed',
      {
        backgroundColor: colors.transparent,
        borderColor: colors.borderDashed,
        borderStyle: 'dashed',
      },
    ],
  ])('a variante %s tem o fundo, a borda e o raio do protótipo', (variant, expected) => {
    render(
      <Card variant={variant} testID="card">
        <Text>conteúdo</Text>
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveStyle(expected);
  });

  it('o destaque troca a borda por lima', () => {
    render(
      <Card variant="inset" highlight testID="card">
        <Text>#1</Text>
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveStyle({
      borderColor: withAlpha(colors.points, tints.soft.border),
    });
  });

  it('o padding por prop vence o da variante nos quatro lados', () => {
    render(
      <Card variant="compact" padding="none" testID="card">
        <Text>conteúdo</Text>
      </Card>,
    );
    expect(screen.getByTestId('card')).toHaveStyle({ paddingVertical: 0, paddingHorizontal: 0 });
  });
});
