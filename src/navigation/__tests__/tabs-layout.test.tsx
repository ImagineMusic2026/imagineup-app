import { Stack } from 'expo-router';
import { fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import TabsLayout from '@/app/(tabs)/_layout';
import { motion } from '@/theme';

const label = (text: string) =>
  function Label() {
    return <Text>{text}</Text>;
  };

/** O layout das abas de verdade, com telas vazias. */
const appTree = {
  _layout: () => <Stack />,
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(inicio,explorar,ranking,perfil)/_layout': {
    default: () => <Stack />,
    unstable_settings: {
      inicio: { anchor: 'index' },
      explorar: { anchor: 'explorar' },
      ranking: { anchor: 'ranking' },
      perfil: { anchor: 'perfil' },
    },
  },
  '(tabs)/(inicio)/index': label('home'),
  '(tabs)/(explorar)/explorar': label('explore'),
  '(tabs)/(ranking)/ranking': label('ranking'),
  '(tabs)/(perfil)/perfil': label('profile'),
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('layout das abas', () => {
  it('as abas entram do fundo escuro em fade, como um grupo só', () => {
    // Segura a entrada no primeiro quadro, o que se vê quando o grupo troca.
    jest.spyOn(Reanimated, 'withTiming').mockImplementation((value) => (value === 1 ? 0 : value));

    renderRouter(appTree, { initialUrl: '/' });
    expect(screen.getByText('home')).toBeOnTheScreen();

    const group = screen
      .UNSAFE_getAllByType(View)
      .find((node) => node.props.needsOffscreenAlphaCompositing === true);
    if (!group) throw new Error('abas sem o grupo que entra em fade');
    expect(StyleSheet.flatten(group.props.style) as ViewStyle).toMatchObject({ opacity: 0 });

    // A entrada começa quando o grupo aparece na tela.
    fireEvent(group, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 402, height: 874 } },
    });
    expect(Reanimated.withTiming).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ duration: motion.duration.slow }),
    );
  });
});
