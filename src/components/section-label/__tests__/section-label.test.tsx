import { render, screen } from '@testing-library/react-native';

import { colors, spacing } from '@/theme';

import { SectionLabel, type SectionLabelSpacing } from '..';

describe('SectionLabel', () => {
  it('é cabeçalho para o leitor, com o texto como frase', () => {
    render(<SectionLabel>Esta semana</SectionLabel>);
    expect(screen.getByRole('header', { name: 'Esta semana' })).toBeOnTheScreen();
  });

  it('sai em caixa alta pela variante, no cinza mínimo que passa contraste', () => {
    render(<SectionLabel>Hoje</SectionLabel>);
    expect(screen.getByText('Hoje')).toHaveStyle({
      textTransform: 'uppercase',
      color: colors.textMuted,
    });
  });

  it.each<[SectionLabelSpacing, number]>([
    ['default', spacing.sectionLabelTop],
    ['tight', spacing.sectionTopTight],
    ['month', spacing.blockGap],
  ])('o espaço %s tem %s em cima e 10 embaixo', (preset, top) => {
    render(<SectionLabel spacing={preset}>Novembro</SectionLabel>);
    expect(screen.getByText('Novembro')).toHaveStyle({
      paddingTop: top,
      paddingBottom: spacing.listGap,
    });
  });
});
