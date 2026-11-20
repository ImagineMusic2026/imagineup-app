import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, ActivityIndicator, StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Polygon } from 'react-native-svg';

import { Logo } from '@/components/logo';
import { Scrim } from '@/components/scrim';
import { t } from '@/i18n';
import { colors, motion, radii, shadows, spacing, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';

import { AccountMoment, type AccountMomentPhase } from '../components/account-moment';
import { AuthLogo } from '../components/auth-backdrop';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const metrics = {
  frame: { x: 0, y: 0, width: 402, height: 874 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

const CREATING = t('auth.signUp.creating');
const CREATED = t('auth.signUp.created.title');
const LEAD = t('auth.signUp.created.lead');

function moment(phase: AccountMomentPhase) {
  return (
    <SafeAreaProvider initialMetrics={metrics}>
      <AccountMoment phase={phase} />
    </SafeAreaProvider>
  );
}

/**
 * Opacidade de cada barra da marca no primeiro quadro. O mock do Reanimated
 * cria o valor de novo a cada render: o desenho mostra o valor inicial, e o
 * movimento se confere pelas animações que ele pede.
 */
function barsOpacity(): number[] {
  return screen.root
    .findAll((node) => node.type === Polygon)
    .map((node) => {
      const animated = node.props.animatedProps as { fillOpacity: number } | undefined;
      return animated ? animated.fillOpacity : (node.props.fillOpacity as number);
    });
}

/** O anel: a caixa redonda (em host) em volta das barras. */
function ring() {
  const [box, ...others] = screen.root.findAll(
    (node) =>
      typeof node.type === 'string' &&
      StyleSheet.flatten(node.props.style)?.borderRadius === radii.pill,
  );
  if (!box || others.length > 0) throw new Error('o momento devia ter um anel só');
  return box;
}

/** Caixa (em host) mais próxima acima do nó. */
function hostParent(node: ReturnType<typeof screen.getByText>) {
  let current = node.parent;
  while (current && typeof current.type !== 'string') current = current.parent;
  return current;
}

/** O indicador da espera, o do sistema, quando está na tela. */
const spinner = () => screen.UNSAFE_queryByType(ActivityIndicator);

/** O que a caixa do texto mostra, de cima para baixo: o título e, embaixo dele, o apoio ou o indicador. */
function textBlock(): string[] {
  const box = hostParent(screen.getByRole('header'));
  if (!box) throw new Error('título sem caixa em volta');
  return box
    .findAll((node) => node.type === ActivityIndicator || (node.type as string) === 'Text')
    .map((node) => (node.type === ActivityIndicator ? 'indicador' : String(node.props.children)));
}

let timing: jest.SpyInstance;
let delay: jest.SpyInstance;
let repeat: jest.SpyInstance;
let announce: jest.SpyInstance;

/** As entradas pedidas (o bloco subindo com fade), fora o acender das barras. */
const entrances = () =>
  timing.mock.calls.filter(
    ([, config]) => (config as { duration?: number }).duration === motion.duration.base,
  );

beforeEach(() => {
  // O `AccessibilityInfo` do Jest já é um mock, e o `restoreAllMocks` não zera as chamadas dele.
  jest.clearAllMocks();
  mockReducedMotion = false;
  timing = jest.spyOn(Reanimated, 'withTiming');
  delay = jest.spyOn(Reanimated, 'withDelay');
  repeat = jest.spyOn(Reanimated, 'withRepeat');
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('momento do cadastro', () => {
  it('criando: o título, sem o texto de apoio, e as barras inteiras pulsando devagar', () => {
    render(moment('creating'));
    expect(screen.getByRole('header', { name: CREATING })).toHaveStyle({
      ...typography.titleOnboarding,
      textAlign: 'center',
    });
    expect(screen.queryByText(LEAD)).toBeNull();
    expect(barsOpacity()).toEqual([1, 0.6, 0.28]);
    // Em laço, indo e voltando.
    expect(repeat).toHaveBeenCalledTimes(1);
    expect(repeat).toHaveBeenCalledWith(expect.anything(), -1, true);
  });

  it('criando: um indicador rosa gira embaixo do título, onde depois entra o texto de apoio', () => {
    render(moment('creating'));
    expect(textBlock()).toEqual([CREATING, 'indicador']);
    // Em rosa, a cor de ação (lima é só para pontos), e girando.
    expect(spinner()?.props.color).toBe(colors.accent);
    expect(spinner()?.props.animating).not.toBe(false);
  });

  it('criando: o indicador é desenho: o leitor de tela fica com o título', () => {
    render(moment('creating'));
    const indicator = screen.UNSAFE_getByType(ActivityIndicator);
    expect(isHiddenFromAccessibility(indicator)).toBe(true);
    expect(indicator.props).toMatchObject({
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
      accessibilityElementsHidden: true,
    });
    expect(screen.getByRole('header', { name: CREATING })).toBeOnTheScreen();
  });

  it('criando, quem fala com o leitor de tela é o envio do cadastro: o momento não repete', () => {
    render(moment('creating'));
    expect(announce).not.toHaveBeenCalled();
  });

  it('criada: o título e o texto de apoio, e as barras acendem uma depois da outra', () => {
    render(moment('created'));
    expect(screen.getByRole('header', { name: CREATED })).toBeOnTheScreen();
    expect(screen.getByText(LEAD)).toHaveStyle({
      ...typography.bodyLead,
      color: colors.textSecondary,
      textAlign: 'center',
    });
    // Nascem apagadas e acendem em sequência, 80 ms entre elas, sem pulsar.
    expect(barsOpacity()).toEqual([0, 0, 0]);
    expect(delay.mock.calls.map(([wait]) => wait)).toEqual([0, 80, 160]);
    expect(repeat).not.toHaveBeenCalled();
    // A espera acabou: o texto de apoio fica no lugar do indicador.
    expect(textBlock()).toEqual([CREATED, LEAD]);
    expect(spinner()).toBeNull();
  });

  it('criada: o leitor de tela ouve o momento uma vez', () => {
    const { rerender } = render(moment('creating'));
    rerender(moment('created'));
    expect(announce.mock.calls).toEqual([['Conta criada! Agora escolha seus artistas.']]);

    // A tela renderiza de novo enquanto segura o momento: não repete.
    rerender(moment('created'));
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('da espera para a conta criada, as barras param de pulsar e acendem do zero', () => {
    const { rerender } = render(moment('creating'));
    expect(barsOpacity()).toEqual([1, 0.6, 0.28]);
    repeat.mockClear();

    rerender(moment('created'));
    expect(barsOpacity()).toEqual([0, 0, 0]);
    expect(delay.mock.calls.map(([wait]) => wait)).toEqual([0, 80, 160]);
    expect(repeat).not.toHaveBeenCalled();
  });

  it('da espera para a conta criada, o indicador sai junto com o "Criando sua conta"', () => {
    const { rerender } = render(moment('creating'));
    expect(spinner()).not.toBeNull();

    rerender(moment('created'));
    expect(spinner()).toBeNull();
    expect(screen.queryByText(CREATING)).toBeNull();
    expect(textBlock()).toEqual([CREATED, LEAD]);
  });

  it('o bloco entra subindo com fade: o anel uma vez, e o texto de novo quando a conta nasce', () => {
    const { rerender } = render(moment('creating'));
    // No primeiro quadro, o anel e o texto estão apagados, 12 pt abaixo.
    const start = { opacity: 0, transform: [{ translateY: motion.stagger.rise }] };
    expect(ring()).toHaveStyle(start);
    expect(hostParent(screen.getByText(CREATING))).toHaveStyle(start);
    expect(entrances()).toEqual([
      [1, expect.objectContaining({ easing: motion.easing.out })],
      [1, expect.objectContaining({ easing: motion.easing.out })],
    ]);

    timing.mockClear();
    rerender(moment('created'));
    expect(entrances()).toHaveLength(1);
  });

  it('o anel é rosa tingido, com o brilho, e fica a 242 da área segura de cima', () => {
    render(moment('creating'));
    expect(ring()).toHaveStyle({
      width: 112,
      height: 112,
      backgroundColor: withAlpha(colors.accent, tints.soft.fill),
      borderColor: withAlpha(colors.accent, tints.soft.border),
      ...shadows.glowAccentLarge,
    });
    expect(hostParent(ring())).toHaveStyle({ alignItems: 'center' });
    // O vão de cima é um espaçador que encolhe quando falta altura (aparelho
    // pequeno com a fonte grande): o bloco sobe em vez de passar da tela.
    expect(screen.getByTestId('account-moment-top')).toHaveStyle({
      height: 242,
      minHeight: spacing.xl,
      flexShrink: 1,
    });
  });

  it('o logo do fundo vem de novo por cima do véu, no mesmo lugar e a .75', () => {
    render(moment('creating'));
    const scrim = screen.UNSAFE_getByType(Scrim);
    const logo = screen.UNSAFE_getByType(AuthLogo);
    expect(logo.parent).toBe(scrim.parent);
    const layers = scrim.parent!.children;
    expect(layers.indexOf(logo)).toBeGreaterThan(layers.indexOf(scrim));
    expect(screen.UNSAFE_getByType(Logo).props).toMatchObject({ height: 17, opacity: 0.75 });
  });

  it('é tela cheia sobre o fundo das telas de conta, com o véu das perguntas, e não tem botão', () => {
    render(moment('created'));
    expect(screen.UNSAFE_getByType(Scrim).props.preset).toBe('authQuestion');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('com reduzir movimento, o bloco nasce no lugar e as barras ficam inteiras, paradas', () => {
    mockReducedMotion = true;
    const { rerender } = render(moment('creating'));
    const still = { opacity: 1, transform: [{ translateY: 0 }] };
    expect(ring()).toHaveStyle(still);
    expect(hostParent(screen.getByText(CREATING))).toHaveStyle(still);
    expect(barsOpacity()).toEqual([1, 0.6, 0.28]);
    // Com as barras paradas, o indicador é o que mostra a espera andando: fica, e ligado.
    expect(textBlock()).toEqual([CREATING, 'indicador']);
    expect(spinner()?.props.animating).not.toBe(false);

    rerender(moment('created'));
    expect(barsOpacity()).toEqual([1, 0.6, 0.28]);
    expect(hostParent(screen.getByText(CREATED))).toHaveStyle(still);
    expect(repeat).not.toHaveBeenCalled();
    expect(timing).not.toHaveBeenCalled();
    // O anúncio não é movimento: continua saindo.
    expect(announce).toHaveBeenCalledTimes(1);
  });
});
