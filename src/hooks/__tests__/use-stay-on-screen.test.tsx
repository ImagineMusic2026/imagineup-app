import { renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { useStayOnScreen } from '../use-stay-on-screen';

const mockSetOptions = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ setOptions: mockSetOptions }),
}));

type BackListener = Parameters<typeof BackHandler.addEventListener>[1];

// O evento do voltar não traz nada que o hook leia.
const backEvent = {} as Parameters<BackListener>[0];

let listeners: BackListener[];
let remove: jest.Mock;

beforeEach(() => {
  mockSetOptions.mockClear();
  listeners = [];
  remove = jest.fn();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return { remove };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useStayOnScreen', () => {
  it('preso: o voltar do Android não sai da tela e o gesto de voltar desliga', () => {
    renderHook(() => useStayOnScreen(true));
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    expect(listeners).toHaveLength(1);
    // `true` diz ao Android que o voltar já foi tratado: a tela fica.
    expect(listeners[0]?.(backEvent)).toBe(true);
  });

  it('solto de novo, o voltar e o gesto voltam a funcionar', () => {
    const { rerender } = renderHook(({ locked }: { locked: boolean }) => useStayOnScreen(locked), {
      initialProps: { locked: true },
    });
    rerender({ locked: false });
    expect(remove).toHaveBeenCalled();
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it('solto, não mexe no voltar', () => {
    renderHook(() => useStayOnScreen(false));
    expect(listeners).toHaveLength(0);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });
});
