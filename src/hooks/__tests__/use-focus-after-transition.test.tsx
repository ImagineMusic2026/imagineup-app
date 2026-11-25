import { renderHook } from '@testing-library/react-native';
import type { TextInput as NativeTextInput } from 'react-native';

import { useFocusAfterTransition } from '../use-focus-after-transition';

type TransitionListener = (event: { data: { closing: boolean } }) => void;

// A pilha em volta da tela: guarda quem escuta o fim da transição.
const mockTransition = { listeners: [] as TransitionListener[], stop: jest.fn() };
const mockAddListener = jest.fn((_type: string, listener: TransitionListener) => {
  mockTransition.listeners.push(listener);
  return mockTransition.stop;
});
// O mesmo objeto a cada render, como o navegador de verdade.
const mockNavigation = { addListener: mockAddListener };
jest.mock('expo-router', () => ({
  useNavigation: () => mockNavigation,
}));

/** O campo montado, visto só pelo que o hook usa dele. */
function field() {
  const focus = jest.fn();
  return { node: { focus } as unknown as NativeTextInput, focus };
}

/** A pilha avisa que a transição terminou: a tela entrou (`closing` falso) ou saiu. */
function endTransition(closing: boolean): void {
  mockTransition.listeners.forEach((listener) => listener({ data: { closing } }));
}

beforeEach(() => {
  mockTransition.listeners = [];
  mockTransition.stop.mockClear();
  mockAddListener.mockClear();
});

describe('useFocusAfterTransition', () => {
  it('a entrada da tela terminou: o foco vai de novo ao campo, e o teclado sobe', () => {
    const { node, focus } = field();
    renderHook(() => useFocusAfterTransition({ current: node }));

    expect(mockAddListener).toHaveBeenCalledWith('transitionEnd', expect.any(Function));
    // Durante a animação da pilha, quem focou foi o `autoFocus`: o hook espera.
    expect(focus).not.toHaveBeenCalled();

    endTransition(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('a tela saindo (a transição de fechar) não puxa o foco de volta', () => {
    const { node, focus } = field();
    renderHook(() => useFocusAfterTransition({ current: node }));

    endTransition(true);
    expect(focus).not.toHaveBeenCalled();
  });

  it('vale o campo que está no ref quando a transição termina: ele pode montar depois da tela', () => {
    const input: { current: NativeTextInput | null } = { current: null };
    renderHook(() => useFocusAfterTransition(input));

    const { node, focus } = field();
    input.current = node;
    endTransition(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('sem campo montado, o fim da transição não faz nada', () => {
    renderHook(() => useFocusAfterTransition({ current: null }));
    expect(() => endTransition(false)).not.toThrow();
  });

  it('outro render da tela não refaz a escuta', () => {
    const { node, focus } = field();
    const input = { current: node };
    const { rerender } = renderHook(() => useFocusAfterTransition(input));
    rerender({});

    expect(mockAddListener).toHaveBeenCalledTimes(1);
    expect(mockTransition.stop).not.toHaveBeenCalled();
    endTransition(false);
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('a tela desmontada para de escutar a pilha', () => {
    const { node } = field();
    const { unmount } = renderHook(() => useFocusAfterTransition({ current: node }));
    expect(mockTransition.stop).not.toHaveBeenCalled();

    unmount();
    expect(mockTransition.stop).toHaveBeenCalledTimes(1);
  });
});
