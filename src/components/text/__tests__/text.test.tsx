import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { colors, typography, type TypographyVariant } from '@/theme';

import { MAX_FONT_SCALE, maxFontScaleOf, Text } from '..';

describe('Text', () => {
  it.each<TypographyVariant>(['body', 'label', 'titlePage', 'metaSmall', 'bodyXs', 'input'])(
    'a variante %s cresce até 200% com a fonte do sistema',
    (variant) => {
      render(<Text variant={variant}>texto</Text>);
      expect(screen.getByText('texto')).toHaveProp('maxFontSizeMultiplier', 2);
    },
  );

  it.each<TypographyVariant>([
    'chip',
    'chipSmall',
    'badge',
    'badgeSmall',
    'pointsTiny',
    'micro',
    'statLabel',
    'labelTiny',
    'dateMonth',
    'microLabel',
    'overlineStrong',
  ])('a variante %s, presa a layout fixo, para em 150%', (variant) => {
    render(<Text variant={variant}>texto</Text>);
    expect(screen.getByText('texto')).toHaveProp('maxFontSizeMultiplier', 1.5);
  });

  it('o rótulo da tab bar para em 130%', () => {
    render(<Text variant="tabLabel">Início</Text>);
    expect(screen.getByText('Início')).toHaveProp('maxFontSizeMultiplier', 1.3);
  });

  it('quem compõe camadas lê o mesmo limite que o Text aplica', () => {
    expect(maxFontScaleOf('chip')).toBe(1.5);
    expect(maxFontScaleOf('labelSmall')).toBe(MAX_FONT_SCALE);
    expect(MAX_FONT_SCALE).toBe(2);
  });

  it('o limite passado por prop vence o da variante', () => {
    render(
      <Text variant="chip" maxFontSizeMultiplier={1.2}>
        texto
      </Text>,
    );
    expect(screen.getByText('texto')).toHaveProp('maxFontSizeMultiplier', 1.2);
  });

  it('aplica a família da variante e a cor, sem fontWeight', () => {
    render(
      <Text variant="badge" color={colors.points}>
        nível 7
      </Text>,
    );
    const text = screen.getByText('nível 7');
    expect(text).toHaveStyle({ ...typography.badge, color: colors.points });
    expect(StyleSheet.flatten(text.props.style).fontWeight).toBeUndefined();
  });
});
