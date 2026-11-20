import {
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MAX_FONT_SCALE } from '@/components/text';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { colors, layout, opacities, radii, spacing, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { EmailPill } from '../components/email-pill';

const EMAIL = 'camila@x.com';
// 32 letras: com a fonte grande, não cabe numa linha da pergunta.
const LONG_EMAIL = 'camila.ribeiro.souza@exemplo.com';

const pill = (email = EMAIL) =>
  screen.getByRole('button', { name: t('auth.emailPill', { email }) });

/** O campo nativo por baixo do texto, fora do leitor de tela. */
const field = () => screen.getByDisplayValue(EMAIL, { includeHiddenElements: true });

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: ReturnType<typeof field>) {
  let current = node.parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  if (!current) throw new Error('nó sem caixa em volta');
  return current;
}

/** A pílula desenhada: a caixa (em host) com o raio de pílula. */
function drawnPill() {
  const [box, ...others] = screen.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.borderRadius === radii.pill,
  );
  if (!box || others.length > 0) throw new Error('a pílula devia ser uma caixa só');
  return box;
}

describe('pílula do e-mail', () => {
  afterEach(() => jest.restoreAllMocks());

  it('é um botão só, com alvo de 44, que diz o que o toque faz e com qual e-mail', () => {
    render(<EmailPill email={EMAIL} onPress={jest.fn()} />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(pill()).toHaveProp('accessibilityLabel', 'Trocar o e-mail camila@x.com');
    expect(pill()).toHaveStyle({ minHeight: layout.minTouchTarget });
  });

  it('o toque volta à pergunta do e-mail, com o toque leve dos outros voltares', () => {
    const trigger = jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
    const onPress = jest.fn();
    render(<EmailPill email={EMAIL} onPress={onPress} />);

    fireEvent.press(pill());
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('tap');
  });

  it('mostra o e-mail inteiro: cresce com a fonte e quebra a linha, sem reticências', () => {
    render(<EmailPill email={EMAIL} onPress={jest.fn()} />);
    const label = screen.getByText(EMAIL);
    expect(label).toHaveStyle({ ...typography.tabItem, color: colors.textBody });
    expect(label.props.numberOfLines).toBeUndefined();
    // Sem caber na pergunta, o texto encolhe e a pílula não passa da largura dela.
    expect(pill()).toHaveStyle({ maxWidth: '100%' });
    expect(hostParent(label)).toHaveStyle({ flexShrink: 1 });
  });

  it('com a fonte grande, o e-mail longo quebra a linha e aparece inteiro, sem reticências: é a última conferência antes de criar a conta', () => {
    render(<EmailPill email={LONG_EMAIL} onPress={jest.fn()} />);
    const label = screen.getByText(LONG_EMAIL);
    // Inteiro: o texto é o e-mail como veio, sem limite de linhas nem corte.
    expect(label.props.children).toBe(LONG_EMAIL);
    expect(label.props.numberOfLines).toBeUndefined();
    expect(label.props.ellipsizeMode).toBeUndefined();
    // Cresce com a fonte do sistema até 200%, e não encolhe a letra para caber.
    expect(label).toHaveProp('maxFontSizeMultiplier', MAX_FONT_SCALE);
    expect(label.props.allowFontScaling).not.toBe(false);
    expect(label.props.adjustsFontSizeToFit).toBeUndefined();

    // Quem cede é a caixa do texto, que encolhe até a largura da pergunta, e o
    // texto quebra dentro dela; os ícones dos lados ficam inteiros.
    const textBox = hostParent(label);
    expect(textBox).toHaveStyle({ flexShrink: 1 });
    expect(pill(LONG_EMAIL)).toHaveStyle({ maxWidth: '100%' });
    // Nada tem altura (ou largura) fixa: a pílula e o alvo crescem com as linhas.
    for (const node of [textBox, drawnPill(), pill(LONG_EMAIL)]) {
      const style = StyleSheet.flatten(node.props.style);
      expect(style.height).toBeUndefined();
      expect(style.maxHeight).toBeUndefined();
      expect(style.width).toBeUndefined();
      expect(style.overflow).toBeUndefined();
    }
    expect(drawnPill()).toHaveStyle({ minHeight: 32 });
    expect(pill(LONG_EMAIL)).toHaveStyle({ minHeight: layout.minTouchTarget });
    // As linhas a mais ficam no centro, como a primeira.
    expect(label).toHaveStyle({ textAlign: 'center' });
  });

  it('o e-mail longo vai inteiro também no rótulo do botão e no campo do gerenciador de senhas', () => {
    render(<EmailPill email={LONG_EMAIL} onPress={jest.fn()} />);
    expect(pill(LONG_EMAIL)).toHaveProp(
      'accessibilityLabel',
      'Trocar o e-mail camila.ribeiro.souza@exemplo.com',
    );
    expect(screen.getByDisplayValue(LONG_EMAIL, { includeHiddenElements: true })).toHaveProp(
      'editable',
      false,
    );
  });

  it('por baixo vai um campo só de leitura com o e-mail, marcado como o nome de usuário para o gerenciador de senhas', () => {
    render(<EmailPill email={EMAIL} onPress={jest.fn()} />);
    expect(field().props).toMatchObject({
      value: EMAIL,
      editable: false,
      autoComplete: 'username',
      textContentType: 'username',
    });
    // Na mesma caixa do texto, para o sistema ver o campo onde o e-mail aparece.
    expect(hostParent(hostParent(field()))).toBe(hostParent(screen.getByText(EMAIL)));
    expect(hostParent(field())).toHaveStyle({ position: 'absolute', top: 0, bottom: 0 });
  });

  it('o campo não aparece, não recebe toque e some para o leitor de tela', () => {
    render(<EmailPill email={EMAIL} onPress={jest.fn()} />);
    // Texto a 1% de alfa: o campo segue à vista para o sistema e não se enxerga.
    // Com alfa zero o React Native ignora a cor, e o Android desenha o campo
    // desativado em cinza, dobrando o e-mail atrás do texto.
    expect(field()).toHaveStyle({ color: withAlpha(colors.text, 0.01) });
    expect(StyleSheet.flatten(field().props.style)?.opacity).toBeUndefined();
    expect(hostParent(field())).toHaveProp('pointerEvents', 'none');
    expect(isHiddenFromAccessibility(field())).toBe(true);
    expect(screen.queryByDisplayValue(EMAIL)).toBeNull();
  });

  it('a pílula é de vidro, no meio do alvo, e cresce com o texto', () => {
    render(<EmailPill email={EMAIL} onPress={jest.fn()} />);
    expect(pill()).toHaveStyle({ justifyContent: 'center' });
    expect(drawnPill()).toHaveStyle({
      minHeight: 32,
      paddingVertical: spacing.xs,
      backgroundColor: colors.glass,
      borderColor: colors.borderGlass,
    });
    // Altura mínima, e não fixa: a fonte a 200% e o e-mail em duas linhas não são cortados.
    expect(StyleSheet.flatten(drawnPill().props.style)?.height).toBeUndefined();
  });

  it('desativada, apaga, não volta e diz ao leitor que está desativada', () => {
    const onPress = jest.fn();
    render(<EmailPill email={EMAIL} onPress={onPress} disabled />);

    fireEvent.press(pill());
    expect(onPress).not.toHaveBeenCalled();
    expect(pill()).toBeDisabled();
    expect(pill()).toHaveStyle({ opacity: opacities.disabled });
  });
});
