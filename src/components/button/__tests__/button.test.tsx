import { fireEvent, render, screen } from '@testing-library/react-native';
import { Check } from 'lucide-react-native';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Glass } from '@/components/glass';
import { colors, layout, opacities, radii, shadows, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { Button, type ButtonSize, type ButtonVariant } from '..';

/** O desenho do botão: a superfície com raio dentro do alvo de toque. */
function surfaceStyle(): ViewStyle {
  const styles = screen
    .UNSAFE_getAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style) as ViewStyle | undefined);
  const surface = styles.find((style) => style?.borderRadius !== undefined);
  if (!surface) throw new Error('botão sem superfície');
  return surface;
}

describe('Button', () => {
  it('o leitor ouve o próprio rótulo e o toque dispara a ação', () => {
    const onPress = jest.fn();
    render(<Button label="Entrar" onPress={onPress} />);

    fireEvent.press(screen.getByRole('button', { name: 'Entrar' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('o rótulo do leitor pode dizer mais que o texto visível', () => {
    render(
      <Button label="Eu vou" accessibilityLabel="Eu vou, São João de Irará" onPress={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Eu vou, São João de Irará' })).toBeTruthy();
  });

  it('carregando: mostra o indicador, avisa que está ocupado e não dispara', () => {
    const onPress = jest.fn();
    render(<Button label="Entrar" onPress={onPress} loading />);

    const button = screen.getByRole('button', { name: 'Entrar' });
    expect(screen.queryByText('Entrar')).toBeNull();
    expect(button).toBeBusy();
    expect(button).toBeDisabled();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('desativado: apaga, avisa o estado e não dispara', () => {
    const onPress = jest.fn();
    render(<Button label="Criar minha conta" onPress={onPress} disabled />);

    const button = screen.getByRole('button', { name: 'Criar minha conta' });
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: opacities.disabled });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('o estado escolhido chega ao leitor de tela', () => {
    render(<Button label="Confirmado" variant="eventsTinted" onPress={jest.fn()} selected />);
    expect(screen.getByRole('button', { name: 'Confirmado' })).toBeSelected();
  });

  it.each<[ButtonVariant, string, string, string]>([
    ['primary', colors.accentStrong, colors.accentStrong, colors.onAccent],
    ['points', colors.points, colors.points, colors.onPoints],
    ['secondary', colors.surfaceRaised, colors.borderStrong, colors.text],
    ['ghost', colors.transparent, colors.borderGlass, colors.text],
    ['inverse', colors.inverse, colors.inverse, colors.onInverse],
    ['outline', colors.transparent, colors.borderOutline, colors.text],
    [
      'pointsTinted',
      withAlpha(colors.points, tints.strong.fill),
      withAlpha(colors.points, tints.strong.border),
      colors.points,
    ],
    ['onPoints', colors.onPoints, colors.onPoints, colors.points],
    [
      'onPointsSoft',
      withAlpha(colors.onPoints, 0.1),
      withAlpha(colors.onPoints, 0.2),
      colors.onPoints,
    ],
    [
      'eventsTinted',
      withAlpha(colors.events, tints.soft.fill),
      withAlpha(colors.events, tints.soft.border),
      colors.events,
    ],
  ])(
    'a variante %s pinta fundo, borda e rótulo com as cores do tema',
    (variant, bg, border, fg) => {
      render(<Button label="Ação" variant={variant} onPress={jest.fn()} />);

      expect(surfaceStyle()).toMatchObject({ backgroundColor: bg, borderColor: border });
      expect(screen.getByText('Ação')).toHaveStyle({ color: fg });
    },
  );

  it('o vidro desenha com o Glass claro e rótulo em Manrope', () => {
    render(<Button label="Já tenho conta" variant="glass" onPress={jest.fn()} />);

    const glass = screen.UNSAFE_getByType(Glass);
    expect(glass.props.tone).toBe('light');
    expect(glass.props.radius).toBe(radii.cta);
    expect(screen.getByText('Já tenho conta')).toHaveStyle(typography.buttonAlt);
  });

  it.each<[ButtonSize, number, number]>([
    ['lg', layout.buttonHeight.lg, radii.cta],
    ['md', layout.minTouchTarget, radii.sm],
  ])('%s já desenha com o alvo inteiro', (size, height, radius) => {
    render(<Button label="Entrar na central" size={size} onPress={jest.fn()} />);

    expect(surfaceStyle()).toMatchObject({ minHeight: height, borderRadius: radius });
  });

  it.each<[ButtonSize, number, number]>([
    ['mdCompact', 36, radii.sm],
    ['sm', 30, radii.xs],
    ['xs', 29, radii.xxs],
  ])('%s desenha menor, dentro de um alvo de 44', (size, height, radius) => {
    render(<Button label="Eu vou" size={size} variant="outline" onPress={jest.fn()} />);

    expect(screen.getByRole('button', { name: 'Eu vou' })).toHaveStyle({
      minHeight: layout.minTouchTarget,
      minWidth: layout.minTouchTarget,
    });
    expect(surfaceStyle()).toMatchObject({ minHeight: height, borderRadius: radius });
  });

  it('cada tamanho usa a variante de texto do protótipo', () => {
    render(
      <>
        <Button label="Criar conta" onPress={jest.fn()} />
        <Button label="Gerar meu link" size="mdCompact" variant="onPoints" onPress={jest.fn()} />
        <Button label="Ver missões" size="mdCompact" variant="onPointsSoft" onPress={jest.fn()} />
        <Button label="Chamar amigos +10" size="sm" variant="pointsTinted" onPress={jest.fn()} />
        <Button label="Eu vou" size="xs" variant="outline" onPress={jest.fn()} />
      </>,
    );

    expect(screen.getByText('Criar conta')).toHaveStyle(typography.button);
    expect(screen.getByText('Gerar meu link')).toHaveStyle(typography.buttonSmall);
    expect(screen.getByText('Ver missões')).toHaveStyle(typography.labelCompact);
    expect(screen.getByText('Chamar amigos +10')).toHaveStyle(typography.chip);
    expect(screen.getByText('Eu vou')).toHaveStyle(typography.buttonXs);
  });

  it('o rótulo cresce até 200% em todo tamanho, mesmo com a variante de chip', () => {
    render(
      <>
        <Button label="Chamar amigos +10" size="sm" variant="pointsTinted" onPress={jest.fn()} />
        <Button label="Ver missões" size="mdCompact" variant="onPointsSoft" onPress={jest.fn()} />
      </>,
    );
    expect(screen.getByText('Chamar amigos +10')).toHaveProp('maxFontSizeMultiplier', 2);
    expect(screen.getByText('Ver missões')).toHaveProp('maxFontSizeMultiplier', 2);
  });

  it('o brilho sai por padrão só no primário grande', () => {
    const { rerender } = render(<Button label="Entrar" onPress={jest.fn()} />);
    expect(surfaceStyle()).toMatchObject(shadows.glowAccent);

    rerender(<Button label="Eu vou" size="sm" onPress={jest.fn()} />);
    expect(surfaceStyle().boxShadow).toBeUndefined();

    rerender(<Button label="Gerar meu link" size="mdCompact" onPress={jest.fn()} />);
    expect(surfaceStyle().boxShadow).toBeUndefined();

    rerender(<Button label="Resgatar" variant="points" onPress={jest.fn()} />);
    expect(surfaceStyle().boxShadow).toBeUndefined();
  });

  it('glow liga e desliga o brilho de quem chama', () => {
    const { rerender } = render(<Button label="Entrar" glow={false} onPress={jest.fn()} />);
    expect(surfaceStyle().boxShadow).toBeUndefined();

    rerender(<Button label="Resgatar" variant="points" glow onPress={jest.fn()} />);
    expect(surfaceStyle()).toMatchObject(shadows.glowPoints);
  });

  it('o ícone acompanha a cor do rótulo e fica escondido do leitor', () => {
    render(
      <Button
        label="Confirmado"
        icon={Check}
        variant="eventsTinted"
        size="sm"
        onPress={jest.fn()}
      />,
    );

    const icon = screen.UNSAFE_getByType(Check);
    expect(icon.props.color).toBe(colors.events);
    expect(icon.props.size).toBe(14);
    expect(icon.props.accessibilityElementsHidden).toBe(true);
  });

  it('trocar de variante leva o botão às cores e ao rótulo novos', () => {
    const { rerender } = render(<Button label="Eu vou" size="sm" onPress={jest.fn()} />);
    rerender(
      <Button label="Confirmado" variant="eventsTinted" size="sm" selected onPress={jest.fn()} />,
    );

    expect(surfaceStyle()).toMatchObject({
      backgroundColor: withAlpha(colors.events, tints.soft.fill),
    });
    expect(screen.getByRole('button', { name: 'Confirmado' })).toBeSelected();
  });
});
