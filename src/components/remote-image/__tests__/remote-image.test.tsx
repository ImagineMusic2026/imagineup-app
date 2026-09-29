import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { avatarFallbacks, colors, motion } from '@/theme';
import { pickStable } from '@/utils/pick-stable';

import { PhotoFallback, RemoteImage } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

const PHOTO = 'https://exemplo.com/meet.jpg';
const hidden = { includeHiddenElements: true };

describe('RemoteImage', () => {
  beforeEach(() => {
    mockReducedMotion = false;
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('sem foto, mostra o placeholder de marca pelo id', () => {
    render(<RemoteImage uri={null} fallback={{ kind: 'brand', seed: 'meet-netto' }} />);
    expect(screen.UNSAFE_getByType(PhotoFallback).props).toMatchObject({
      seed: 'meet-netto',
      variant: 'brand',
    });
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
  });

  it('a foto entra por cima com fade e o placeholder só sai depois do fade', () => {
    render(<RemoteImage uri={PHOTO} fallback={{ kind: 'brand', seed: 'meet-netto' }} />);
    const image = screen.UNSAFE_getByType(Image);
    expect(image.props).toMatchObject({
      source: { uri: PHOTO },
      contentFit: 'cover',
      transition: motion.duration.base,
    });
    // Carregando: o placeholder fica embaixo.
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(1);

    fireEvent(image, 'load');
    act(() => jest.advanceTimersByTime(motion.duration.base - 1));
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(1);

    act(() => jest.advanceTimersByTime(1));
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(0);
  });

  it('com reduzir movimento, a foto entra sem fade', () => {
    mockReducedMotion = true;
    render(<RemoteImage uri={PHOTO} fallback={{ kind: 'brand', seed: 'meet-netto' }} />);
    expect(screen.UNSAFE_getByType(Image).props.transition).toBe(0);
  });

  it('se a foto falhar, o placeholder fica', () => {
    render(<RemoteImage uri={PHOTO} fallback={{ kind: 'events', seed: 'up-1m-ev1' }} />);
    fireEvent(screen.UNSAFE_getByType(Image), 'error', { error: 'falhou' });
    act(() => jest.runOnlyPendingTimers());
    expect(screen.UNSAFE_getByType(PhotoFallback).props.variant).toBe('events');
  });

  it('trocar de foto (lista reciclada) volta a mostrar o placeholder até a nova carregar', () => {
    const { rerender } = render(
      <RemoteImage uri={PHOTO} fallback={{ kind: 'brand', seed: 'p-g1' }} />,
    );
    fireEvent(screen.UNSAFE_getByType(Image), 'load');
    act(() => jest.runOnlyPendingTimers());
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(0);

    rerender(
      <RemoteImage
        uri="https://exemplo.com/outra.jpg"
        fallback={{ kind: 'brand', seed: 'p-g2' }}
      />,
    );
    expect(screen.UNSAFE_getByType(PhotoFallback).props.seed).toBe('p-g2');
    expect(screen.UNSAFE_getByType(Image).props.recyclingKey).toBe('https://exemplo.com/outra.jpg');
  });

  it('iniciais sobre a cor estável do id, como a miniatura da central', () => {
    render(
      <RemoteImage
        uri={null}
        fallback={{ kind: 'initials', seed: 'nenho', name: 'Nenho Silva' }}
      />,
    );
    const initials = screen.getByText('NS', hidden);
    expect(initials).toHaveProp('maxFontSizeMultiplier', 1);
    let box = initials.parent;
    while (box && (box.type as unknown) !== 'View') box = box.parent;
    expect(StyleSheet.flatten(box?.props.style).backgroundColor).toBe(
      pickStable('nenho', avatarFallbacks),
    );
  });

  it('`surface` deixa só o fundo neutro', () => {
    render(<RemoteImage uri={null} fallback={{ kind: 'surface', seed: 'x' }} testID="foto" />);
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);
    expect(screen.getByTestId('foto', hidden)).toHaveStyle({
      backgroundColor: colors.surfaceRaised,
    });
  });

  it('é decorativa por padrão; com rótulo vira imagem para o leitor', () => {
    const { rerender } = render(
      <RemoteImage uri={PHOTO} fallback={{ kind: 'brand', seed: 'p-clipe' }} testID="foto" />,
    );
    expect(screen.queryByTestId('foto')).toBeNull();

    rerender(
      <RemoteImage
        uri={PHOTO}
        fallback={{ kind: 'brand', seed: 'p-clipe' }}
        accessibilityLabel="Foto do clipe"
      />,
    );
    expect(screen.getByRole('image', { name: 'Foto do clipe' })).toBeTruthy();
  });
});
