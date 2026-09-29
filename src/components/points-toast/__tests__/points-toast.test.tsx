import { act, isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { haptics } from '@/services/haptics';
import { motion, spacing } from '@/theme';

import { PointsToast, pointsToastAnnouncement } from '..';

let mockReducedMotion = false;
jest.mock('@/hooks/use-prefers-reduced-motion', () => ({
  usePrefersReducedMotion: () => mockReducedMotion,
}));

// A pílula fica fora do leitor, e as consultas padrão ignoram o que o leitor não vê.
const hidden = { includeHiddenElements: true } as const;

let announce: jest.SpyInstance;
let vibrate: jest.SpyInstance;

beforeEach(() => {
  mockReducedMotion = false;
  jest.useFakeTimers();
  // O jest do RN já troca o anúncio por um mock, que o restore não zera.
  announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions')
    .mockImplementation(() => {});
  announce.mockClear();
  vibrate = jest.spyOn(haptics, 'trigger').mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('PointsToast', () => {
  it('na montagem não aparece, mesmo com chave: voltar à tela não repete o ganho', () => {
    render(<PointsToast points={20} trigger="join-1" />);
    expect(screen.queryByText('+20', hidden)).toBeNull();
    expect(announce).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalled();
  });

  it('a troca da chave mostra "+N", vibra pontos ganhos e anuncia uma vez', () => {
    const { rerender } = render(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger="join-1" />);

    expect(screen.getByText('+20', hidden)).toBeTruthy();
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith('pointsEarned');
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith(pointsToastAnnouncement(20), { queue: true });
  });

  it('renderizar de novo com a mesma chave não repete toque nem anúncio', () => {
    const { rerender } = render(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger="join-1" />);
    rerender(<PointsToast points={20} trigger="join-1" announcement="Outra frase" />);

    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('a pílula fica fora do leitor de tela, que já ouviu o anúncio, e não recebe toque', () => {
    const { rerender } = render(<PointsToast testID="toast" points={20} trigger={null} />);
    rerender(<PointsToast testID="toast" points={20} trigger={1} />);

    expect(isHiddenFromAccessibility(screen.getByText('+20', hidden))).toBe(true);
    expect(screen.getByTestId('toast', hidden)).toHaveProp('pointerEvents', 'none');
  });

  it('some no tempo do contador', () => {
    const { rerender } = render(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger={1} />);

    act(() => jest.advanceTimersByTime(motion.duration.counter - 1));
    expect(screen.getByText('+20', hidden)).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByText('+20', hidden)).toBeNull();
  });

  it('a mesma chave, depois de outra, é outro ganho', () => {
    const { rerender } = render(<PointsToast points={20} trigger="a" />);
    rerender(<PointsToast points={20} trigger="b" />);
    rerender(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger="b" />);

    expect(vibrate).toHaveBeenCalledTimes(2);
    expect(announce).toHaveBeenCalledTimes(2);
  });

  it('um ganho novo com a pílula no ar troca o número e ganha o tempo inteiro', () => {
    const { rerender } = render(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger={1} />);
    act(() => jest.advanceTimersByTime(motion.duration.counter / 2));
    rerender(<PointsToast points={10} trigger={2} />);

    expect(screen.queryByText('+20', hidden)).toBeNull();
    act(() => jest.advanceTimersByTime(motion.duration.counter - 1));
    expect(screen.getByText('+10', hidden)).toBeTruthy();
  });

  it('ganho de 1 ponto é anunciado no singular', () => {
    const { rerender } = render(<PointsToast points={1} trigger={null} />);
    rerender(<PointsToast points={1} trigger={1} />);

    expect(screen.getByText('+1', hidden)).toBeTruthy();
    expect(announce).toHaveBeenCalledWith(pointsToastAnnouncement(1), { queue: true });
    expect(pointsToastAnnouncement(1)).not.toBe(pointsToastAnnouncement(2));
  });

  it('a frase da tela substitui o anúncio padrão, num anúncio só', () => {
    const { rerender } = render(<PointsToast points={2} trigger={null} />);
    rerender(
      <PointsToast points={2} trigger={1} announcement="Comentário enviado. Mais 2 pontos" />,
    );

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('Comentário enviado. Mais 2 pontos', { queue: true });
  });

  it('sem pontos, a troca da chave não mostra nem anuncia nada', () => {
    const { rerender } = render(<PointsToast points={0} trigger={null} />);
    rerender(<PointsToast points={0} trigger={1} />);

    expect(screen.queryByText('+0', hidden)).toBeNull();
    expect(vibrate).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  // O mock do Reanimated não guarda valor entre renders: confere a animação pedida.
  it('sobe 12 pt enquanto some, no tempo do contador', () => {
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const { rerender } = render(<PointsToast points={20} trigger={null} />);
    rerender(<PointsToast points={20} trigger={1} />);

    expect(timing).toHaveBeenCalledWith(
      -spacing.md,
      expect.objectContaining({ duration: motion.duration.counter }),
    );
  });

  it('com reduzir movimento, aparece parada e some no mesmo tempo', () => {
    mockReducedMotion = true;
    const timing = jest.spyOn(Reanimated, 'withTiming');
    const { rerender } = render(<PointsToast testID="toast" points={20} trigger={null} />);
    rerender(<PointsToast testID="toast" points={20} trigger={1} />);

    expect(timing).not.toHaveBeenCalled();
    expect(screen.getByTestId('toast', hidden)).toBeTruthy();
    act(() => jest.advanceTimersByTime(motion.duration.counter));
    expect(screen.queryByTestId('toast', hidden)).toBeNull();
  });
});
