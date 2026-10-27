import { fireEvent, render, screen } from '@testing-library/react-native';
import { createRef } from 'react';
import { View } from 'react-native';

import { Pill } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import { haptics } from '@/services/haptics';
import { colors, layout } from '@/theme';

import { PillButton } from '..';

describe('PillButton', () => {
  afterEach(() => jest.restoreAllMocks());

  it('a pílula desenha pequena dentro de um alvo de 44', () => {
    render(<PillButton label="4.812" onPress={jest.fn()} accessibilityLabel="4.812 curtidas" />);

    expect(screen.getByRole('button', { name: '4.812 curtidas' })).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
  });

  it('é um elemento só para o leitor: o rótulo é de quem chama e a pílula não tem papel', () => {
    render(
      <PillButton
        label="Compartilhar +2"
        tone="points"
        onPress={jest.fn()}
        accessibilityLabel="Compartilhar, vale 2 pontos por visita"
      />,
    );

    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: 'Compartilhar, vale 2 pontos por visita' }),
    ).toBeTruthy();
    const pill = screen.UNSAFE_getByType(Pill);
    expect(pill.props.accessibilityLabel).toBeUndefined();
  });

  it('sem rótulo, o leitor ouve o texto da pílula', () => {
    render(<PillButton label="Eu vou" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Eu vou' })).toBeTruthy();
  });

  it('passa tom, tamanho e peça da esquerda para a pílula', () => {
    render(
      <PillButton
        label="4.813"
        size="md"
        leading={<View testID="coracao" />}
        onPress={jest.fn()}
        accessibilityLabel="Descurtir, 4.813 curtidas"
      />,
    );

    expect(screen.getByText('4.813')).toHaveStyle({ color: colors.textSecondary });
    expect(screen.getByTestId('coracao', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByTestId('coracao')).toBeNull();
  });

  it('o estilo da pílula vai no desenho, e o do alvo no pressável', () => {
    render(
      <PillButton
        label="Compartilhar +2"
        tone="points"
        size="md"
        pillStyle={{ paddingHorizontal: 14 }}
        style={{ marginLeft: 3 }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.UNSAFE_getByType(Pill).props.style).toEqual({ paddingHorizontal: 14 });
    expect(screen.getByRole('button')).toHaveStyle({ marginLeft: 3 });
  });

  it('o estado ligado chega ao leitor, como o curtir', () => {
    render(<PillButton label="4.813" selected onPress={jest.fn()} accessibilityLabel="Curtido" />);
    expect(screen.getByRole('button', { name: 'Curtido' })).toBeSelected();
  });

  it('o toque dispara a ação com o haptic pedido', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    const onPress = jest.fn();
    render(<PillButton label="327" haptic="selection" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: '327' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('selection');
  });

  it('desativado: apaga e não dispara', () => {
    const onPress = jest.fn();
    render(<PillButton label="Compartilhar +2" disabled onPress={onPress} />);

    const button = screen.getByRole('button', { name: 'Compartilhar +2' });
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('o segurar chama o onLongPress com o atraso pedido, sem o toque', () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    render(
      <PillButton label="12" onPress={onPress} onLongPress={onLongPress} delayLongPress={400} />,
    );
    const button = screen.getByRole('button', { name: '12' });
    expect(screen.UNSAFE_getByType(PressableScale).props.delayLongPress).toBe(400);
    fireEvent(button, 'longPress');
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('as ações do leitor de tela e o ref vão no pressável de fora', () => {
    const onAction = jest.fn();
    const ref = createRef<View>();
    const actions = [
      { name: 'longpress', label: 'Escolher reação' },
      { name: 'react-fire', label: 'Reagir com fogo' },
    ];
    render(
      <PillButton
        ref={ref}
        label="12"
        onPress={jest.fn()}
        accessibilityActions={actions}
        onAccessibilityAction={onAction}
      />,
    );
    const button = screen.getByRole('button', { name: '12' });
    expect(button).toHaveProp('accessibilityActions', actions);
    fireEvent(button, 'accessibilityAction', { nativeEvent: { actionName: 'react-fire' } });
    expect(onAction).toHaveBeenCalledWith({ nativeEvent: { actionName: 'react-fire' } });
    expect(ref.current).not.toBeNull();
  });
});
