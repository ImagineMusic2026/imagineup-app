import {
  act,
  fireEvent,
  isHiddenFromAccessibility,
  render,
  screen,
} from '@testing-library/react-native';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { colors, motion } from '@/theme';

import { LAUNCH_IMAGE_TIMEOUT_MS, LaunchSplash, launchSplashPlayed } from '..';

jest.mock('expo-splash-screen', () => ({
  hideAsync: jest.fn(() => Promise.resolve()),
}));

const hideAsync = jest.mocked(SplashScreen.hideAsync);
const image = () => screen.UNSAFE_getByType(Image);
const coverStyle = () => StyleSheet.flatten(screen.root.props.style);
const beatStyle = () => StyleSheet.flatten(image().parent?.props.style);
const REST_POSE = [{ translateY: 0 }, { rotate: '0deg' }, { scaleX: 1 }, { scaleY: 1 }];

let onLeave: jest.Mock;
let onDone: jest.Mock;
let timing: jest.SpyInstance;

function renderSplash() {
  return render(<LaunchSplash onLeave={onLeave} onDone={onDone} />);
}

/** Anda o relógio falso dentro do `act`, com as trocas de etapa que ele dispara. */
function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** O `interpolate` do mock do Reanimated não calcula nada: aqui, em linha reta. */
function linear(value: number, input: readonly number[], output: readonly number[]): number {
  for (let index = 1; index < input.length; index += 1) {
    const end = input[index]!;
    if (value <= end) {
      const start = input[index - 1]!;
      const from = output[index - 1]!;
      return from + ((output[index]! - from) * (value - start)) / (end - start);
    }
  }
  return output[output.length - 1]!;
}

beforeEach(() => {
  jest.useFakeTimers();
  onLeave = jest.fn();
  onDone = jest.fn();
  timing = jest.spyOn(Reanimated, 'withTiming');
  jest.spyOn(Reanimated, 'interpolate').mockImplementation(linear);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  hideAsync.mockClear();
});

describe('LaunchSplash', () => {
  it('repete a splash nativa: o símbolo contido em 96 x 96 no meio da tela, sobre o fundo dela', () => {
    renderSplash();
    expect(coverStyle()).toMatchObject({
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    });
    expect(image().props).toMatchObject({
      source: require('@/assets/images/splash-icon.png'),
      contentFit: 'contain',
    });
    expect(StyleSheet.flatten(image().props.style)).toEqual({ width: 96, height: 96 });
    // Parado na pose da splash nativa, para a troca não aparecer.
    expect(beatStyle().transform).toEqual(REST_POSE);
  });

  it('é decorativa e segura o toque enquanto cobre a tela', () => {
    renderSplash();
    expect(isHiddenFromAccessibility(screen.root)).toBe(true);
    expect(screen.root.props.pointerEvents).toBe('auto');
  });

  it('só tira a splash nativa quando o símbolo dela já está na tela', () => {
    renderSplash();
    advance(LAUNCH_IMAGE_TIMEOUT_MS - 1);
    expect(hideAsync).not.toHaveBeenCalled();

    fireEvent(image(), 'display');
    expect(hideAsync).toHaveBeenCalledTimes(1);
    // Um segundo aviso da imagem não tira de novo.
    fireEvent(image(), 'display');
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('espera o fade da splash nativa, bate e sai, e só então a tela de baixo entra', () => {
    renderSplash();
    fireEvent(image(), 'display');

    // Com a splash nativa ainda apagando, o símbolo fica parado.
    advance(motion.launch.handoff - 1);
    expect(timing).not.toHaveBeenCalled();
    advance(1);
    expect(timing).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.launch.beat, easing: Reanimated.Easing.linear }),
    );

    advance(motion.launch.beat - 1);
    expect(onLeave).not.toHaveBeenCalled();
    advance(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(timing).toHaveBeenLastCalledWith(
      0,
      expect.objectContaining({ duration: motion.launch.fade, easing: motion.easing.inOut }),
    );
    // Saindo, o toque já passa para a tela que entra, e o símbolo voltou à pose da splash.
    expect(screen.root.props.pointerEvents).toBe('none');
    expect(beatStyle().transform).toEqual(REST_POSE);

    advance(motion.launch.fade - 1);
    expect(onDone).not.toHaveBeenCalled();
    advance(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(hideAsync).toHaveBeenCalledTimes(1);
  });

  it('sem o símbolo a tempo, a splash nativa sai direto para a tela, sem a abertura', () => {
    renderSplash();
    advance(LAUNCH_IMAGE_TIMEOUT_MS);
    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.toJSON()).toBeNull();
    expect(timing).not.toHaveBeenCalled();
  });

  it('com erro na imagem, também sai direto', () => {
    renderSplash();
    fireEvent(image(), 'error', { error: 'falhou' });
    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);

    advance(LAUNCH_IMAGE_TIMEOUT_MS);
    expect(hideAsync).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('desmontada no meio, não chama mais ninguém', () => {
    const view = renderSplash();
    fireEvent(image(), 'display');
    view.unmount();
    advance(motion.launch.handoff + motion.launch.beat + motion.launch.fade);
    expect(onLeave).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('aparece uma vez por execução do app', () => {
    let fresh: typeof import('..') | undefined;
    jest.isolateModules(() => {
      fresh = jest.requireActual('..');
    });
    // Carregado agora e nunca montado.
    expect(fresh!.launchSplashPlayed()).toBe(false);

    renderSplash();
    expect(launchSplashPlayed()).toBe(true);
  });
});
