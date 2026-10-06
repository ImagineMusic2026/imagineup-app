import { renderHook } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { haptics } from '@/services/haptics';

import { useLevelUp } from '../hooks/use-level-up';
import { noteLevelCelebrated, resetCelebratedLevels } from '../level-celebrated';
import type { Level } from '../types';

const PURAINHA: Level = { number: 7, name: 'Purainha', minXp: 7_000 };
const XODO: Level = { number: 8, name: 'Xodó', minXp: 15_000 };

interface Props {
  level: Level | undefined;
  focused: boolean;
}

function renderLevelUp(initial: Props) {
  return renderHook(({ level, focused }: Props) => useLevelUp(level, focused), {
    initialProps: initial,
  });
}

const announced = () =>
  jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mock.calls.map(([t]) => t);

beforeEach(() => {
  jest.spyOn(haptics, 'trigger').mockImplementation(() => undefined);
  jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('subida de nível', () => {
  it('o primeiro nível visto só fica anotado', () => {
    const { result, rerender } = renderLevelUp({ level: undefined, focused: true });
    rerender({ level: PURAINHA, focused: true });

    expect(result.current).toBeNull();
    expect(haptics.trigger).not.toHaveBeenCalled();
  });

  it('nível maior que o do cache: toca levelUp, anuncia e o selo festeja', () => {
    const { result, rerender } = renderLevelUp({ level: PURAINHA, focused: true });
    rerender({ level: XODO, focused: true });

    expect(result.current).toBe(1);
    expect(haptics.trigger).toHaveBeenCalledWith('levelUp');
    expect(announced()).toEqual(['Você subiu para o nível 8, Xodó.']);

    // A mesma resposta de novo não repete a festa.
    rerender({ level: { ...XODO }, focused: true });
    expect(haptics.trigger).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(1);
  });

  it('fora de foco espera: a festa sai uma vez quando o fã volta ao perfil', () => {
    const { result, rerender } = renderLevelUp({ level: PURAINHA, focused: true });
    rerender({ level: PURAINHA, focused: false });
    rerender({ level: XODO, focused: false });
    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(result.current).toBeNull();

    rerender({ level: XODO, focused: true });
    expect(haptics.trigger).toHaveBeenCalledWith('levelUp');
    expect(haptics.trigger).toHaveBeenCalledTimes(1);
    expect(result.current).toBe(1);
  });

  it('o mesmo nível ou um menor (régua trocada no painel) não festeja', () => {
    const { result, rerender } = renderLevelUp({ level: XODO, focused: true });
    rerender({ level: PURAINHA, focused: true });
    rerender({ level: PURAINHA, focused: true });

    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});

describe('nível já festejado na própria ação (bloco 7)', () => {
  afterEach(() => resetCelebratedLevels());

  it('o selo acende, sem o toque e sem o anúncio de novo', () => {
    // O mock do anúncio guarda as chamadas dos testes de antes.
    jest.mocked(AccessibilityInfo.announceForAccessibilityWithOptions).mockClear();
    // O "+N" da ação que subiu o nível já tocou levelUp e anunciou.
    noteLevelCelebrated(null, XODO.number);
    const { result, rerender } = renderLevelUp({ level: PURAINHA, focused: true });
    rerender({ level: XODO, focused: true });

    expect(result.current).toBe(1);
    expect(haptics.trigger).not.toHaveBeenCalled();
    expect(announced()).toEqual([]);
  });
});
