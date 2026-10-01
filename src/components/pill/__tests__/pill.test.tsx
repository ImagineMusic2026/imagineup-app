import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { colors, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { Pill, pillForeground, pillMinHeight, pillPaddingVertical, type PillTone } from '..';

describe('Pill', () => {
  it.each<[PillTone, string, string]>([
    ['points', colors.points, colors.onPoints],
    ['pointsTint', withAlpha(colors.points, tints.soft.fill), colors.points],
    ['neutral', colors.surfaceRaised, colors.textSecondary],
    ['accentStrong', colors.accentStrong, colors.onAccent],
    ['events', colors.surfaceRaised, colors.events],
  ])('o tom %s pinta o fundo e o texto com as cores do tema', (tone, background, foreground) => {
    render(<Pill testID="pill" label="+20" tone={tone} />);
    expect(screen.getByTestId('pill')).toHaveStyle({ backgroundColor: background });
    expect(screen.getByText('+20')).toHaveStyle({ color: foreground });
    expect(pillForeground[tone]).toBe(foreground);
  });

  it('a contagem neutra usa Manrope e os tons de marca usam Sora', () => {
    render(
      <>
        <Pill label="4.812" tone="neutral" />
        <Pill label="Compartilhar +2" tone="points" />
      </>,
    );
    expect(screen.getByText('4.812')).toHaveStyle(typography.labelTiny);
    expect(screen.getByText('Compartilhar +2')).toHaveStyle(typography.chipSmall);
  });

  it('o selo em caixa alta usa a variante de selo do tamanho', () => {
    render(
      <>
        <Pill label="Nível 7 · Purainha" tone="pointsTint" caps />
        <Pill label="Só 20 vagas" tone="accentStrong" size="xs" caps />
      </>,
    );
    expect(screen.getByText('Nível 7 · Purainha')).toHaveStyle(typography.badge);
    expect(screen.getByText('Só 20 vagas')).toHaveStyle(typography.badgeSmall);
  });

  it('a md tem o padding de 8 do protótipo: 34 com o ícone de 16 e 33 só com o texto', () => {
    render(<Pill testID="pill" label="4.812" size="md" />);
    expect(screen.getByTestId('pill')).toHaveStyle({
      paddingVertical: pillPaddingVertical.md,
      minHeight: pillMinHeight.md,
    });
    expect(pillPaddingVertical.md).toBe(8);
    expect(16 + pillPaddingVertical.md * 2 + 2).toBe(34);
    expect(pillMinHeight.md).toBe(33);
  });

  it('a peça da esquerda fica escondida do leitor de tela', () => {
    render(<Pill label="+20" tone="pointsTint" leading={<View testID="bars" />} />);
    expect(screen.getByTestId('bars', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('bars')).toBeNull();
    expect(screen.getByText('+20')).toBeTruthy();
  });

  it('com rótulo, vira um elemento só para o leitor', () => {
    render(<Pill label="+20" tone="pointsTint" accessibilityLabel="vale 20 pontos" />);
    expect(screen.getByLabelText('vale 20 pontos')).toHaveProp('accessible', true);
  });

  it('sem rótulo, não se agrupa nem assume papel, para caber dentro de um pressável', () => {
    render(<Pill testID="pill" label="4.812" />);
    const pill = screen.getByTestId('pill');
    expect(pill.props.accessible).toBeUndefined();
    expect(pill.props.accessibilityRole).toBeUndefined();
  });
});
