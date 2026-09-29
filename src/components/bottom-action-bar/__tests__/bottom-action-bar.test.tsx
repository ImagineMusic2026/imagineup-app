import { fireEvent, render, screen } from '@testing-library/react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { gradients, spacing } from '@/theme';

import { BottomActionBar } from '..';

function renderWithInsets(ui: ReactElement, bottom: number) {
  const metrics = {
    frame: { x: 0, y: 0, width: 402, height: 874 },
    insets: { top: 47, bottom, left: 0, right: 0 },
  };
  return render(<SafeAreaProvider initialMetrics={metrics}>{ui}</SafeAreaProvider>);
}

const action = (onPress = jest.fn()) => (
  <PressableScale onPress={onPress} accessibilityLabel="Continuar com 3 artistas">
    <Text>Continuar com 3 artistas</Text>
  </PressableScale>
);

describe('BottomActionBar', () => {
  it('fica preso ao pé, por cima da lista, com o véu do rodapé fixo', () => {
    renderWithInsets(<BottomActionBar testID="bar">{action()}</BottomActionBar>, 34);
    expect(screen.getByTestId('bar')).toHaveStyle({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingTop: spacing.blockGap,
      paddingHorizontal: spacing.gutterOnboarding,
    });
    const scrim = screen.UNSAFE_getByType(LinearGradient);
    expect(scrim.props.colors).toEqual(gradients.scrims.bottomBar.colors);
  });

  it('com indicador de início, o respiro de baixo é a área segura', () => {
    renderWithInsets(<BottomActionBar testID="bar">{action()}</BottomActionBar>, 34);
    expect(screen.getByTestId('bar')).toHaveStyle({ paddingBottom: 34 });
  });

  it('sem área segura embaixo (botões do Android), respira 16', () => {
    renderWithInsets(<BottomActionBar testID="bar">{action()}</BottomActionBar>, 0);
    expect(screen.getByTestId('bar')).toHaveStyle({ paddingBottom: spacing.lg });
  });

  it('avisa a altura medida, para a lista não esconder o último item', () => {
    const onHeightChange = jest.fn();
    renderWithInsets(
      <BottomActionBar testID="bar" onHeightChange={onHeightChange}>
        {action()}
      </BottomActionBar>,
      34,
    );
    fireEvent(screen.getByTestId('bar'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 778, width: 402, height: 96 } },
    });
    expect(onHeightChange).toHaveBeenCalledWith(96);
  });

  it('a ação de dentro é o único alvo para o leitor, e responde ao toque', () => {
    const onPress = jest.fn();
    renderWithInsets(<BottomActionBar testID="bar">{action(onPress)}</BottomActionBar>, 34);
    expect(screen.getByTestId('bar')).not.toHaveProp('accessible', true);
    fireEvent.press(screen.getByRole('button', { name: 'Continuar com 3 artistas' }));
    expect(onPress).toHaveBeenCalled();
  });
});
