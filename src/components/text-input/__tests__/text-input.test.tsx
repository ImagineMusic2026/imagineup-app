import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { Eye, Search } from 'lucide-react-native';
import { createRef } from 'react';
import {
  Dimensions,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
  type ViewStyle,
} from 'react-native';

import { Text } from '@/components/text';
import { borderWidths, colors, layout, radii, spacing, typography } from '@/theme';

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

  it('inválido pinta a borda de erro sem mensagem embaixo nem dica para o leitor', () => {
    render(<TextInput label="Senha" variant="glass" invalid />);
    expect(fieldStyle().borderColor).toBe(colors.danger);

    fireEvent(screen.getByLabelText('Senha'), 'focus');
    expect(fieldStyle().borderColor).toBe(colors.danger);
    expect(screen.getByLabelText('Senha').props.accessibilityHint).toBeUndefined();
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

  it('o status do campo vai para a dica do leitor, depois do erro e da dica, sem ser desenhado', () => {
    render(
      <TextInput
        label="Seu @"
        hint="De 3 a 20 letras"
        accessibilityStatus="Indisponível: este @ já tem dono."
      />,
    );
    expect(screen.getByLabelText('Seu @')).toHaveProp(
      'accessibilityHint',
      'De 3 a 20 letras. Indisponível: este @ já tem dono.',
    );
    expect(
      screen.queryByText('Indisponível: este @ já tem dono.', { includeHiddenElements: true }),
    ).toBeNull();
  });

  it('entrega o ref do campo, para o envio inválido levar o foco ao erro', () => {
    const ref = createRef<NativeTextInput>();
    render(<TextInput ref={ref} label="E-mail" />);
    expect(ref.current).not.toBeNull();
  });
});

type Node = ReturnType<typeof screen.getByText>;

/** A caixa (View em host) mais próxima acima do nó. */
function hostBox(node: Node): Node {
  let current = node.parent;
  while (current && (typeof current.type !== 'string' || (current.type as string) === 'Text')) {
    current = current.parent;
  }
  if (!current) throw new Error('sem caixa em volta');
  return current;
}

/** A entrelinha do campo com a fonte do sistema do Jest (o texto cresce até 200%). */
const lineHeight = () =>
  typography.input.lineHeight * Math.min(Dimensions.get('window').fontScale, 2);

/** A caixa do campo sem caixa (`bare`): a que só tem a linha de baixo. */
function bareFieldStyle(): ViewStyle {
  const style = screen
    .UNSAFE_getAllByType(View)
    .map((node) => StyleSheet.flatten(node.props.style) as ViewStyle | undefined)
    .find((item) => item?.borderBottomWidth !== undefined);
  if (!style) throw new Error('campo sem linha');
  return style;
}

describe('TextInput nos cards da tela "Editar perfil"', () => {
  it('bare: sem fundo, sem borda e sem raio; a linha de baixo só acende no foco', () => {
    render(<TextInput label="Nome" labelHidden variant="bare" />);
    expect(bareFieldStyle()).toMatchObject({
      borderWidth: 0,
      borderBottomWidth: borderWidths.default,
      backgroundColor: colors.transparent,
      borderColor: colors.transparent,
    });
    expect(bareFieldStyle().borderRadius).toBeUndefined();
    fireEvent(screen.getByLabelText('Nome'), 'focus');
    expect(bareFieldStyle().borderColor).toBe(colors.accent);
  });

  it('bare com erro: a linha fica no tom de erro e a mensagem alinha com o texto do campo', () => {
    render(<TextInput label="Nome" labelHidden variant="bare" error="Digite seu nome." />);
    expect(bareFieldStyle().borderColor).toBe(colors.danger);
    const message = screen.getByText('Digite seu nome.', { includeHiddenElements: true });
    expect(hostBox(message)).toHaveStyle({ paddingHorizontal: spacing.lg });
  });

  it('o prefixo fica fora do leitor e do toque, e o texto começa depois da largura medida', () => {
    render(<TextInput label="Seu @" labelHidden variant="bare" prefix="@" value="camilarib" />);
    const prefix = screen.getByText('@', { includeHiddenElements: true });
    expect(isHiddenFromAccessibility(prefix)).toBe(true);
    const box = hostBox(prefix);
    expect(box).toHaveProp('pointerEvents', 'none');
    expect(box).toHaveStyle({ left: spacing.lg });
    // O valor do campo não leva o prefixo.
    expect(screen.getByLabelText('Seu @')).toHaveProp('value', 'camilarib');

    fireEvent(box, 'layout', { nativeEvent: { layout: { width: 13.2, height: 20, x: 0, y: 0 } } });
    expect(StyleSheet.flatten(screen.getByLabelText('Seu @').props.style).paddingLeft).toBe(
      spacing.lg + 14,
    );
  });

  it('com o ícone e o prefixo, o prefixo vem depois do ícone', () => {
    render(
      <TextInput
        label="LinkedIn"
        labelHidden
        variant="bare"
        prefix="in/"
        leadingGlyph="linkedin"
      />,
    );
    const box = hostBox(screen.getByText('in/', { includeHiddenElements: true }));
    expect(box).toHaveStyle({ left: spacing.lg + 18 + spacing.sm });
  });

  it('o desenho de marca à esquerda é decorativo e não pega o toque', () => {
    render(<TextInput label="Instagram" labelHidden variant="bare" leadingGlyph="instagram" />);
    const svg = screen.root.find(
      (node) => node.props.viewBox === '0 0 24 24' && node.props.accessibilityElementsHidden,
    );
    expect(svg).toBeTruthy();
    let parent = svg.parent;
    while (parent && parent.props.pointerEvents === undefined) parent = parent.parent;
    expect(parent).toHaveProp('pointerEvents', 'none');
  });

  it('várias linhas: o texto no topo, com a entrelinha, e a caixa com 3 linhas', () => {
    render(<TextInput label="Bio" labelHidden variant="bare" multiline />);
    const input = screen.getByLabelText('Bio');
    expect(input).toHaveProp('textAlignVertical', 'top');
    expect(input).toHaveStyle({ lineHeight: typography.input.lineHeight });
    expect(bareFieldStyle()).toMatchObject({
      alignItems: 'flex-start',
      minHeight: lineHeight() * 3 + spacing.md * 2,
    });
  });

  it('várias linhas com ícone: o ícone fica na altura da primeira linha', () => {
    render(<TextInput label="Bio" labelHidden variant="bare" multiline leadingIcon={Search} />);
    const box = screen.UNSAFE_getByType(Search).parent?.parent;
    expect(box).toHaveStyle({ top: spacing.md, height: lineHeight() });
  });

  it('o rodapé fica embaixo da caixa do texto, fora dela', () => {
    render(
      <TextInput
        label="Bio"
        labelHidden
        variant="bare"
        multiline
        footer={<Text testID="contador">0/200</Text>}
      />,
    );
    const footer = screen.getByTestId('contador');
    const field = screen.root.find(
      (node) =>
        typeof node.type !== 'string' &&
        StyleSheet.flatten(node.props.style)?.borderBottomWidth !== undefined,
    );
    expect(field.findAll((node) => node.props.testID === 'contador')).toHaveLength(0);
    expect(footer).toBeTruthy();
  });

  it('o padrão de sempre não muda: com caixa, sem prefixo nem status', () => {
    render(<TextInput label="E-mail" />);
    expect(fieldStyle()).toMatchObject({
      borderRadius: radii.md,
      backgroundColor: colors.surface,
      borderWidth: borderWidths.default,
    });
    const input = screen.getByLabelText('E-mail');
    expect(StyleSheet.flatten(input.props.style).paddingLeft).toBeUndefined();
    expect(input.props.textAlignVertical).toBeUndefined();
    expect(input.props.accessibilityHint).toBeUndefined();
  });
});
