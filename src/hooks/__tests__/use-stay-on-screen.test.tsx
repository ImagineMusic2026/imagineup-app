import { renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { useStayOnScreen } from '../use-stay-on-screen';

type TabPressListener = (event: { preventDefault: () => void }) => void;

const mockSetOptions = jest.fn();
// A aba em volta da pilha: guarda quem escuta o toque nela.
const mockTabPress = { listeners: [] as TabPressListener[], stop: jest.fn() };
jest.mock('expo-router', () => ({
  useNavigation: () => ({
    setOptions: mockSetOptions,
    getParent: () => ({
      addListener: (_type: 'tabPress', listener: TabPressListener) => {
        mockTabPress.listeners.push(listener);
        return mockTabPress.stop;
      },
    }),
  }),
}));

type BackListener = Parameters<typeof BackHandler.addEventListener>[1];

// O evento do voltar não traz nada que o hook leia.
const backEvent = {} as Parameters<BackListener>[0];

let listeners: BackListener[];
let remove: jest.Mock;

beforeEach(() => {
  mockSetOptions.mockClear();
  mockTabPress.listeners = [];
  mockTabPress.stop.mockClear();
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

  it('preso: tocar de novo na aba não volta a pilha ao topo', () => {
    renderHook(() => useStayOnScreen(true));
    const preventDefault = jest.fn();
    expect(mockTabPress.listeners).toHaveLength(1);
    mockTabPress.listeners[0]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('solto de novo, o voltar, o gesto e a aba voltam a funcionar', () => {
    const { rerender } = renderHook(({ locked }: { locked: boolean }) => useStayOnScreen(locked), {
      initialProps: { locked: true },
    });
    rerender({ locked: false });
    expect(remove).toHaveBeenCalled();
    expect(mockTabPress.stop).toHaveBeenCalled();
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it('solto, não mexe no voltar nem na aba', () => {
    renderHook(() => useStayOnScreen(false));
    expect(listeners).toHaveLength(0);
    expect(mockTabPress.listeners).toHaveLength(0);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });
});
