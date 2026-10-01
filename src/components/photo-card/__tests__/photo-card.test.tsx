import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, StyleSheet } from 'react-native';

import { PhotoFallback, StaticPhotoFallback } from '@/components/remote-image';
import { Text } from '@/components/text';
import { gradients, layout } from '@/theme';

import { PhotoCard } from '..';

jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => false,
}));

describe('PhotoCard', () => {
  it('sem foto, desenha o placeholder pelo id e o véu do preset', () => {
    render(
      <PhotoCard uri={null} fallback={{ kind: 'brand', seed: 'meet-netto' }} scrim="rewardHero">
        <Text>Meet & greet com o Netto</Text>
      </PhotoCard>,
    );
    expect(screen.UNSAFE_getByType(PhotoFallback).props.seed).toBe('meet-netto');
    expect(screen.UNSAFE_getByType(LinearGradient).props.colors).toEqual(
      gradients.scrims.rewardHero.colors,
    );
    expect(screen.getByText('Meet & greet com o Netto')).toBeTruthy();
  });

  it('com a medida esperada (destaques da 1h e da 1m), o placeholder sai em SVG no primeiro quadro', () => {
    render(
      <PhotoCard
        uri={null}
        fallback={{ kind: 'events', seed: 'sao-joao' }}
        fallbackSize={{ width: 366, height: layout.eventHeroMinHeight }}
        scrim="eventHero"
      />,
    );
    expect(screen.UNSAFE_getByType(StaticPhotoFallback).props).toMatchObject({
      seed: 'sao-joao',
      variant: 'events',
      width: 366,
      height: layout.eventHeroMinHeight,
    });
    expect(screen.UNSAFE_queryAllByType(PhotoFallback)).toHaveLength(0);
  });

  it('pressável: vira um botão só, com o rótulo do card, e o toque chega', () => {
    const onPress = jest.fn();
    render(
      <PhotoCard
        uri={null}
        fallback={{ kind: 'brand', seed: 'meet-netto' }}
        scrim="rewardHero"
        onPress={onPress}
        accessibilityLabel="Meet & greet com o Netto. Só 20 vagas. 10.000 pontos."
      >
        <Text>Meet & greet com o Netto</Text>
      </PhotoCard>,
    );
    const card = screen.getByRole('button', {
      name: 'Meet & greet com o Netto. Só 20 vagas. 10.000 pontos.',
    });
    expect(screen.getAllByRole('button')).toHaveLength(1);

    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('sem onPress não é botão, e os botões de dentro seguem focáveis um a um', () => {
    render(
      <PhotoCard
        uri={null}
        fallback={{ kind: 'events', seed: 'up-1m-ev1' }}
        scrim="eventHero"
        minHeight={layout.eventHeroMinHeight}
      >
        <Pressable accessibilityRole="button" accessibilityLabel="Eu vou" onPress={jest.fn()} />
      </PhotoCard>,
    );
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Eu vou' })).toBeTruthy();
  });

  it('cresce com o texto: altura mínima, nunca fixa', () => {
    render(
      <PhotoCard
        uri={null}
        fallback={{ kind: 'brand', seed: 'meet-netto' }}
        scrim="rewardHero"
        minHeight={layout.rewardHeroMinHeight}
        testID="card"
      />,
    );
    const card = screen.getByTestId('card');
    expect(card).toHaveStyle({ minHeight: layout.rewardHeroMinHeight });
    expect(StyleSheet.flatten(card.props.style).height).toBeUndefined();
  });

  it('o selo do canto fica em cima e o conteúdo embaixo, sem se sobrepor', () => {
    render(
      <PhotoCard
        uri={null}
        fallback={{ kind: 'events', seed: 'up-1m-ev1' }}
        scrim="eventHero"
        topLeft={<Text>21 OUT</Text>}
        testID="card"
      >
        <Text>São João de Irará</Text>
      </PhotoCard>,
    );
    expect(screen.getByTestId('card')).toHaveStyle({ justifyContent: 'space-between' });
    expect(screen.getByText('21 OUT')).toBeTruthy();
    expect(screen.getByText('São João de Irará')).toBeTruthy();
  });
});
