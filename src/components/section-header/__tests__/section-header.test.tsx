import { fireEvent, render, screen, within } from '@testing-library/react-native';

import { colors, layout, spacing, typography } from '@/theme';

import { SectionHeader, type SectionHeaderSpacing } from '..';

const outset = (layout.minTouchTarget - typography.headingSection.lineHeight) / 2;

describe('SectionHeader', () => {
  it('o título é um cabeçalho para o leitor de tela, sem nada tocável', () => {
    render(<SectionHeader title="Conquistas" />);
    expect(screen.getByRole('header', { name: 'Conquistas' })).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a contagem fica cinza dentro do cabeçalho e não vira botão', () => {
    render(<SectionHeader title="Comentários" count="327" />);
    const header = screen.getByRole('header');
    expect(within(header).getByText('327')).toHaveStyle({ color: colors.textMuted });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a contagem na ponta ("14 de 32" da 1e) continua dentro do cabeçalho, sem toque', () => {
    render(
      <SectionHeader
        title="Conquistas"
        count="14 de 32"
        countPlacement="end"
        accessibilityLabel="Conquistas, 14 de 32 conquistadas"
      />,
    );
    const header = screen.getByRole('header', { name: 'Conquistas, 14 de 32 conquistadas' });
    expect(header).toHaveStyle({ flex: 1, justifyContent: 'space-between' });
    expect(within(header).getByText('14 de 32')).toHaveStyle({ color: colors.textMuted });
    // Sem tabular: o "1" tabular abre um vão ("1 4").
    expect(within(header).getByText('14 de 32')).not.toHaveStyle({
      fontVariant: ['tabular-nums'],
    });
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('título e contagem podem ser lidos numa frase de quem chama', () => {
    render(
      <SectionHeader
        title="Comentários"
        count="327"
        accessibilityLabel="Comentários, 327 no total"
      />,
    );
    expect(screen.getByRole('header', { name: 'Comentários, 327 no total' })).toBeOnTheScreen();
  });

  it('o link é rosa, fala a frase completa e tem alvo de 44', () => {
    const onPress = jest.fn();
    render(
      <SectionHeader
        title="Suas centrais"
        action={{ label: 'Ver todas', onPress, accessibilityLabel: 'Ver todas as suas centrais' }}
      />,
    );

    const link = screen.getByRole('button', { name: 'Ver todas as suas centrais' });
    expect(link).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
    expect(within(link).getByText('Ver todas')).toHaveStyle({ color: colors.accent });

    fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('o link pode se apresentar como link', () => {
    render(
      <SectionHeader
        title="Suas centrais"
        action={{
          label: 'Ver todas',
          onPress: jest.fn(),
          accessibilityLabel: 'Ver todas as suas centrais',
          accessibilityRole: 'link',
        }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Ver todas as suas centrais' })).toBeOnTheScreen();
  });

  it.each<[SectionHeaderSpacing, number, number]>([
    ['default', spacing.sectionTop, spacing.sectionBottom],
    ['tight', spacing.blockGap, spacing.listGap],
    ['compact', spacing.sectionTopTight, spacing.metaGap],
  ])('sem link, o espaço %s é o do protótipo (%s em cima, %s embaixo)', (preset, top, bottom) => {
    render(<SectionHeader testID="header" title="Conquistas" spacing={preset} />);
    expect(screen.getByTestId('header')).toHaveStyle({ paddingTop: top, paddingBottom: bottom });
  });

  it('com link, a linha cresce para 44 e desconta a sobra do padding', () => {
    render(
      <SectionHeader
        testID="header"
        title="Suas centrais"
        action={{ label: 'Ver todas', onPress: jest.fn(), accessibilityLabel: 'Ver todas' }}
      />,
    );
    expect(screen.getByTestId('header')).toHaveStyle({
      minHeight: layout.minTouchTarget,
      paddingTop: spacing.sectionTop - outset,
      paddingBottom: 0,
    });
  });
});
