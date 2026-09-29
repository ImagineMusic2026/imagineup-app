import { fireEvent, render, screen } from '@testing-library/react-native';
import { Eye, Search } from 'lucide-react-native';
import { createRef } from 'react';
import { StyleSheet, View, type TextInput as NativeTextInput, type ViewStyle } from 'react-native';

import { colors, layout, radii, spacing, typography } from '@/theme';

import { TextInput, TextInputAction } from '..';

jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

/** A caixa do campo (fundo, borda e raio), em volta do texto digitado. */
function fieldStyle(): ViewStyle {
  const styles = screen
    .UNSAFE_getAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style) as ViewStyle | undefined);
  const field = styles.find((style) => style?.borderRadius !== undefined);
  if (!field) throw new Error('campo sem caixa');
  return field;
}

describe('TextInput', () => {
  it('rótulo e erro chegam pelo próprio campo, e os textos visíveis ficam escondidos do leitor', () => {
    render(<TextInput label="E-mail" error="Digite um e-mail válido." />);

    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveProp('accessibilityHint', 'Digite um e-mail válido.');
    expect(screen.getByText('E-mail', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('E-mail')).toBeNull();
    expect(screen.queryByText('Digite um e-mail válido.')).toBeNull();
  });

  it('a dica aparece embaixo e é lida junto com o erro, numa frase só', () => {
    render(<TextInput label="Senha" error="Senha curta" hint="Pelo menos 6 caracteres" />);

    expect(screen.getByLabelText('Senha')).toHaveProp(
      'accessibilityHint',
      'Senha curta. Pelo menos 6 caracteres.',
    );
    expect(
      screen.getByText('Pelo menos 6 caracteres', { includeHiddenElements: true }),
    ).toHaveStyle({ color: colors.textMuted });
  });

  it('sem erro nem dica, o campo não tem dica para o leitor', () => {
    render(<TextInput label="E-mail" />);
    expect(screen.getByLabelText('E-mail').props.accessibilityHint).toBeUndefined();
  });

  it('com o rótulo escondido, o campo continua com nome para o leitor', () => {
    render(<TextInput label="Buscar artista" labelHidden placeholder="Buscar por nome" />);

    expect(screen.getByLabelText('Buscar artista')).toBeTruthy();
    expect(screen.queryByText('Buscar artista', { includeHiddenElements: true })).toBeNull();
  });

  it('o foco pinta a borda de rosa e o erro vence o foco', () => {
    const { rerender } = render(<TextInput label="E-mail" />);
    expect(fieldStyle().borderColor).toBe(colors.border);

    fireEvent(screen.getByLabelText('E-mail'), 'focus');
    expect(fieldStyle().borderColor).toBe(colors.accent);

    rerender(<TextInput label="E-mail" error="Digite um e-mail válido." />);
    expect(fieldStyle().borderColor).toBe(colors.danger);

    fireEvent(screen.getByLabelText('E-mail'), 'blur');
    expect(fieldStyle().borderColor).toBe(colors.danger);
  });

  it('repassa foco e saída para quem chama', () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    render(<TextInput label="E-mail" onFocus={onFocus} onBlur={onBlur} />);

    fireEvent(screen.getByLabelText('E-mail'), 'focus');
    fireEvent(screen.getByLabelText('E-mail'), 'blur');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('a variante vidro usa o raio do CTA, o fundo e a borda de vidro', () => {
    render(<TextInput label="E-mail" variant="glass" />);
    expect(fieldStyle()).toMatchObject({
      borderRadius: radii.cta,
      backgroundColor: colors.glass,
      borderColor: colors.borderGlass,
    });
  });

  it('o texto digitado usa a fonte do token input', () => {
    render(<TextInput label="E-mail" />);
    expect(screen.getByLabelText('E-mail')).toHaveStyle({
      fontFamily: typography.input.fontFamily,
      fontSize: typography.input.fontSize,
      color: colors.text,
    });
  });

  it('a lupa da esquerda fica fora do leitor e deixa o toque chegar ao campo', () => {
    render(<TextInput label="Buscar artista" labelHidden leadingIcon={Search} />);

    const icon = screen.UNSAFE_getByType(Search);
    expect(icon.props.accessibilityElementsHidden).toBe(true);
    // A caixa do ícone não recebe toque, e o campo começa na borda, embaixo dela.
    expect(icon.parent?.parent).toHaveProp('pointerEvents', 'none');
    const input = screen.getByLabelText('Buscar artista');
    expect(StyleSheet.flatten(input.props.style).paddingLeft).toBeGreaterThan(spacing.lg);
    expect(StyleSheet.flatten(input.props.style).flex).toBe(1);
  });

  it('o botão da direita é um alvo de 44 dentro do campo, com o rótulo de quem chama', () => {
    const onPress = jest.fn();
    render(
      <TextInput
        label="Senha"
        secureTextEntry
        trailing={
          <TextInputAction icon={Eye} onPress={onPress} accessibilityLabel="Mostrar senha" />
        }
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Mostrar senha' });
    expect(toggle).toHaveStyle({ width: layout.minTouchTarget, height: layout.minTouchTarget });
    fireEvent.press(toggle);
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Senha')).toBeTruthy();
  });

  it('o ícone da ação é decorativo: quem fala é o botão', () => {
    render(<TextInputAction icon={Search} onPress={jest.fn()} accessibilityLabel="Buscar" />);
    expect(screen.UNSAFE_getByType(Search).props.accessibilityElementsHidden).toBe(true);
  });

  it('entrega o ref do campo, para o envio inválido levar o foco ao erro', () => {
    const ref = createRef<NativeTextInput>();
    render(<TextInput ref={ref} label="E-mail" />);
    expect(ref.current).not.toBeNull();
  });
});
