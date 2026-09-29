import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { haptics } from '@/services/haptics';

import { PressableScale } from '..';

beforeEach(() => {
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PressableScale', () => {
  it('o toque dispara a ação com o toque do evento', () => {
    const onPress = jest.fn();
    render(
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel="Netto Brito">
        <Text>Netto Brito</Text>
      </PressableScale>,
    );

    fireEvent.press(screen.getByRole('button', { name: 'Netto Brito' }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('selection');
  });

  it('o toque duplo do VoiceOver chega direto, sem toque simulado no centro', () => {
    const onPress = jest.fn();
    render(
      <PressableScale onPress={onPress} accessibilityLabel="Buscar por nome">
        <Text>Buscar por nome</Text>
      </PressableScale>,
    );

    fireEvent(screen.getByRole('button', { name: 'Buscar por nome' }), 'accessibilityTap');
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(haptics.trigger).toHaveBeenCalledWith('tap');
  });

  it('desativado, nem o toque nem o leitor de tela disparam', () => {
    const onPress = jest.fn();
    render(
      <PressableScale onPress={onPress} disabled accessibilityLabel="Continuar">
        <Text>Continuar</Text>
      </PressableScale>,
    );

    const button = screen.getByRole('button', { name: 'Continuar' });
    expect(button).toBeDisabled();
    expect(button.props.onAccessibilityTap).toBeUndefined();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});
