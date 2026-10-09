import { renderHook } from '@testing-library/react-native';
import { BackHandler } from 'react-native';

import { useStayOnScreen } from '../use-stay-on-screen';

type TabPressListener = (event: { preventDefault: () => void }) => void;

const mockSetOptions = jest.fn();
// A aba em volta da pilha: guarda quem escuta o toque nela.
const mockTabPress = { listeners: [] as TabPressListener[], stop: jest.fn() };
// O mesmo objeto a cada render, como o navegador de verdade.
const mockNavigation = {
  setOptions: mockSetOptions,
  getParent: () => ({
    addListener: (_type: 'tabPress', listener: TabPressListener) => {
      mockTabPress.listeners.push(listener);
      return mockTabPress.stop;
    },
  }),
};
jest.mock('expo-router', () => ({
  useNavigation: () => mockNavigation,
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

describe('useStayOnScreen com os modos (o "Descartar alterações?" da tela "Editar perfil")', () => {
  it('free é o booleano false: nada preso', () => {
    renderHook(() => useStayOnScreen('free', jest.fn()));
    expect(listeners).toHaveLength(0);
    expect(mockTabPress.listeners).toHaveLength(0);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
  });

  it('locked é o booleano true: o gesto desliga, o voltar não sai e a aba não volta ao topo', () => {
    const onAsk = jest.fn();
    renderHook(() => useStayOnScreen('locked', onAsk));
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    expect(listeners[0]?.(backEvent)).toBe(true);
    expect(onAsk).not.toHaveBeenCalled();
    const preventDefault = jest.fn();
    mockTabPress.listeners[0]?.({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it('confirm: o gesto desliga e o voltar do Android chama a pergunta, sem sair', () => {
    const onAsk = jest.fn();
    renderHook(() => useStayOnScreen('confirm', onAsk));
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: false });
    expect(listeners).toHaveLength(1);
    expect(listeners[0]?.(backEvent)).toBe(true);
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('confirm não segura o toque na aba: só o locked segura', () => {
    renderHook(() => useStayOnScreen('confirm', jest.fn()));
    expect(mockTabPress.listeners).toHaveLength(0);
  });

  it('a pergunta nova vale sem refazer a escuta', () => {
    const first = jest.fn();
    const second = jest.fn();
    const { rerender } = renderHook(
      ({ onAsk }: { onAsk: () => void }) => useStayOnScreen('confirm', onAsk),
      { initialProps: { onAsk: first } },
    );
    rerender({ onAsk: second });
    expect(listeners).toHaveLength(1);
    expect(remove).not.toHaveBeenCalled();
    listeners[0]?.(backEvent);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('do confirm ao locked (o ✓ começou a salvar): o voltar deixa de perguntar e a aba passa a ser segura', () => {
    const onAsk = jest.fn();
    const { rerender } = renderHook(
      ({ mode }: { mode: 'confirm' | 'locked' | 'free' }) => useStayOnScreen(mode, onAsk),
      { initialProps: { mode: 'confirm' } },
    );
    rerender({ mode: 'locked' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(listeners).toHaveLength(2);
    listeners[1]?.(backEvent);
    expect(onAsk).not.toHaveBeenCalled();
    expect(mockTabPress.listeners).toHaveLength(1);

    rerender({ mode: 'free' });
    expect(mockSetOptions).toHaveBeenLastCalledWith({ gestureEnabled: true });
    expect(mockTabPress.stop).toHaveBeenCalled();
  });
});
