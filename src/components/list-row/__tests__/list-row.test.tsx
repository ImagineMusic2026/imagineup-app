import { fireEvent, render, screen } from '@testing-library/react-native';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { haptics } from '@/services/haptics';
import { borderWidths, colors, radii, spacing, typography } from '@/theme';

import { ListRow } from '..';

jest.mock('@/services/haptics', () => ({ haptics: { trigger: jest.fn() } }));

beforeEach(() => {
  jest.mocked(haptics.trigger).mockClear();
});

describe('ListRow', () => {
  it('mostra título e meta, com a meta no cinza mínimo', () => {
    render(<ListRow title="Traga 3 amigos novos pro app" meta="1 de 3 cadastrados" />);
    expect(screen.getByText('Traga 3 amigos novos pro app')).toHaveStyle({ color: colors.text });
    expect(screen.getByText('1 de 3 cadastrados')).toHaveStyle({ color: colors.textMuted });
  });

  it('pressável, é um botão só com o rótulo de quem chama', () => {
    const onPress = jest.fn();
    render(
      <ListRow
        title="Netto Brito"
        meta="#12 entre 412 mil fãs"
        trailing={<Text>4.120</Text>}
        onPress={onPress}
        accessibilityLabel="Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos"
      />,
    );

    const row = screen.getByRole('button', {
      name: 'Netto Brito, 12º lugar entre 412 mil fãs, 4.120 pontos',
    });
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('pressável, esconde o que vai à direita do leitor e deixa o toque passar para a linha', () => {
    const onRowPress = jest.fn();
    const onInnerPress = jest.fn();
    render(
      <ListRow
        testID="linha"
        title="Leve 5 pessoas para o clipe novo"
        onPress={onRowPress}
        accessibilityLabel="Leve 5 pessoas para o clipe novo. Vale 20 pontos."
        trailing={
          <PressableScale onPress={onInnerPress} accessibilityLabel="Compartilhar">
            <Text>+20</Text>
          </PressableScale>
        }
      />,
    );

    // Oculto do leitor: as consultas só acham com os elementos ocultos incluídos.
    expect(screen.queryByTestId('linha-trailing')).toBeNull();
    const trailing = screen.getByTestId('linha-trailing', { includeHiddenElements: true });
    expect(trailing).toHaveProp('importantForAccessibility', 'no-hide-descendants');
    expect(trailing).toHaveProp('accessibilityElementsHidden', true);
    expect(screen.queryByRole('button', { name: 'Compartilhar' })).toBeNull();

    fireEvent.press(screen.getByText('+20', { includeHiddenElements: true }));
    expect(onInnerPress).not.toHaveBeenCalled();
    expect(onRowPress).toHaveBeenCalledTimes(1);
  });

  it('sem onPress, a linha inteira é um elemento só com o rótulo de quem chama', () => {
    const label = '4º, Maria Clara Souza, Salvador, BA, 6.844 pontos';
    render(
      <ListRow
        variant="divided"
        title="Maria Clara Souza"
        meta="Salvador, BA"
        trailing={<Text>6.844</Text>}
        accessibilityLabel={label}
      />,
    );
    expect(screen.getByLabelText(label)).toHaveProp('accessible', true);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('com o grupo de conteúdo, o botão da direita fica com foco e ação próprios', () => {
    const onRsvp = jest.fn();
    render(
      <ListRow
        title="Pra Encher e Derramar"
        meta="Feira de Santana, BA"
        accessibilityGroup="content"
        accessibilityLabel="28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia"
        trailing={
          <PressableScale onPress={onRsvp} accessibilityLabel="Eu vou, Pra Encher e Derramar">
            <Text>Eu vou</Text>
          </PressableScale>
        }
      />,
    );

    expect(
      screen.getByLabelText('28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia'),
    ).toHaveProp('accessible', true);
    fireEvent.press(screen.getByRole('button', { name: 'Eu vou, Pra Encher e Derramar' }));
    expect(onRsvp).toHaveBeenCalledTimes(1);
  });

  it('pressável com valor à direita exige o rótulo, porque o valor fica fora do leitor', () => {
    const row = (
      // @ts-expect-error sem accessibilityLabel, o "+20" some para o leitor de tela
      <ListRow title="Comente em 3 posts" trailing={<Text>+20</Text>} onPress={jest.fn()} />
    );
    expect(row).toBeTruthy();
  });

  it('bloqueada e pressável: apagada, com o toque de bloqueio e sem se dizer desativada', () => {
    const onPress = jest.fn();
    render(
      <ListRow
        testID="linha"
        tone="locked"
        title="Missão relâmpago do show"
        meta="Abre quando o Netto subir no palco"
        onPress={onPress}
        accessibilityLabel="Missão relâmpago do show. Bloqueada."
      />,
    );

    // O "Bloqueada" vai no rótulo: desativada, o leitor diria que não responde,
    // e o TalkBack nem entregaria o toque que anuncia a dica.
    const row = screen.getByRole('button', { name: 'Missão relâmpago do show. Bloqueada.' });
    expect(row).not.toBeDisabled();
    expect(row).toHaveStyle({ borderColor: colors.borderSubtle });
    expect(screen.getByText('Missão relâmpago do show')).toHaveStyle({ color: colors.textMuted });

    // Continua tocável: quem chama anuncia a dica.
    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('locked');
  });

  it('bloqueada e sem toque, a linha se diz desativada', () => {
    render(<ListRow tone="locked" title="Backstage" accessibilityLabel="Backstage. Bloqueada." />);
    expect(screen.getByLabelText('Backstage. Bloqueada.')).toBeDisabled();
  });

  it('pressável ocupada: o leitor ouve que a ação está andando', () => {
    render(<ListRow title="Sair" onPress={jest.fn()} busy />);
    expect(screen.getByRole('button', { name: 'Sair' })).toBeBusy();
  });

  it('pressável com estado de quem chama: a linha com papel de switch diz se está marcada', () => {
    render(
      <ListRow
        title="Conta privada"
        meta="Os outros fãs não veem sua bio nem suas redes."
        trailing={<Text>chave</Text>}
        onPress={jest.fn()}
        accessibilityRole="switch"
        accessibilityState={{ checked: true }}
        accessibilityLabel="Conta privada. Os outros fãs não veem sua bio nem suas redes."
        variant="divided"
      />,
    );
    expect(
      screen.getByRole('switch', {
        name: 'Conta privada. Os outros fãs não veem sua bio nem suas redes.',
        checked: true,
      }),
    ).toBeTruthy();
  });

  it('o estado de quem chama soma com o ocupado, nas duas variantes', () => {
    const { rerender } = render(
      <ListRow title="Gênero" onPress={jest.fn()} busy accessibilityState={{ expanded: true }} />,
    );
    const card = screen.getByRole('button', { name: 'Gênero' });
    expect(card).toBeBusy();
    expect(card).toBeExpanded();

    rerender(
      <ListRow
        title="Gênero"
        variant="divided"
        onPress={jest.fn()}
        accessibilityState={{ expanded: false }}
      />,
    );
    const divided = screen.getByRole('button', { name: 'Gênero' });
    expect(divided).toBeCollapsed();
    expect(divided).not.toBeBusy();
  });

  it('haptic null desliga o toque', () => {
    render(<ListRow title="Comente em 3 posts" onPress={jest.fn()} haptic={null} />);
    fireEvent.press(screen.getByRole('button'));
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('o card de lista tem o raio e o vão do protótipo', () => {
    render(<ListRow testID="linha" title="Traga 3 amigos" />);
    expect(screen.getByTestId('linha')).toHaveStyle({
      backgroundColor: colors.surface,
      borderRadius: radii.lg,
      paddingVertical: spacing.cardPadding,
      gap: spacing.itemGap,
    });
  });

  it('o compacto é mais baixo e usa a meta menor', () => {
    render(<ListRow testID="linha" variant="compact" title="Nenho" meta="#41 entre 298 mil fãs" />);
    expect(screen.getByTestId('linha')).toHaveStyle({
      borderRadius: radii.md,
      paddingVertical: spacing.tileGap,
      gap: spacing.gridGap,
    });
    expect(screen.getByText('#41 entre 298 mil fãs')).toHaveStyle({
      fontSize: typography.metaSmall.fontSize,
    });
  });

  it('a dividida não tem fundo e leva a linha embaixo', () => {
    render(<ListRow testID="linha" variant="divided" title="Alan Ferreira" />);
    const row = screen.getByTestId('linha');
    expect(row).toHaveStyle({
      paddingVertical: spacing.gridGap,
      borderBottomWidth: borderWidths.default,
      borderBottomColor: colors.borderSubtle,
    });
    expect(row).not.toHaveStyle({ backgroundColor: colors.surface });
  });

  it('o botão da direita pode descer para baixo do conteúdo, alinhado à esquerda', () => {
    render(
      <ListRow
        testID="linha"
        title="Pra Encher e Derramar"
        meta="Feira de Santana, BA"
        accessibilityGroup="content"
        accessibilityLabel="28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia"
        trailingPlacement="below"
        trailing={
          <PressableScale onPress={jest.fn()} accessibilityLabel="Eu vou, Pra Encher e Derramar">
            <Text>Eu vou</Text>
          </PressableScale>
        }
      />,
    );

    expect(screen.getByTestId('linha')).toHaveStyle({
      flexDirection: 'column',
      alignItems: 'stretch',
    });
    expect(screen.getByTestId('linha-trailing')).toHaveStyle({ alignSelf: 'flex-start' });
    // O conteúdo fica com a altura dele, e continua um foco só.
    expect(
      screen.getByLabelText('28 de outubro, Pra Encher e Derramar, Feira de Santana, Bahia'),
    ).toHaveStyle({ flex: 0 });
    expect(screen.getByRole('button', { name: 'Eu vou, Pra Encher e Derramar' })).toBeTruthy();
  });

  it('vão e padding podem trocar pelos tokens da agenda', () => {
    render(<ListRow testID="linha" title="Arrocha na Praia" gap="rowGap" padding="md" />);
    expect(screen.getByTestId('linha')).toHaveStyle({
      gap: spacing.rowGap,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
    });
  });
});
