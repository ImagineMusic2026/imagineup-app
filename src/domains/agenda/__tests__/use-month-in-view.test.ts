import { act, renderHook } from '@testing-library/react-native';

import { buildAgendaItems, groupByMonth, type AgendaListItem } from '../group-by-month';
import { useMonthInView } from '../hooks/use-month-in-view';
import type { AgendaEvent } from '../types';

const NOW = new Date(2026, 8, 29, 20, 0);

function show(id: string, startsAt: Date): AgendaEvent {
  return {
    id,
    title: id,
    artists: [],
    city: 'Serrinha',
    state: 'BA',
    startsAt: startsAt.toISOString(),
    imageUrl: null,
    invitePointsPerSignup: null,
  };
}

const IRARA = show('irara', new Date(2026, 9, 21, 22));
const ITEMS = buildAgendaItems(
  groupByMonth(
    [
      show('praia', new Date(2026, 9, 3, 22)),
      IRARA,
      show('vaqueiro', new Date(2026, 10, 12, 20)),
      show('vaquejada', new Date(2026, 11, 2, 22)),
    ],
    NOW,
    IRARA,
  ),
);

/** O que a FlashList diria que está à vista. */
const viewable = (...keys: string[]) => ({
  viewableItems: keys.map((key) => {
    const index = ITEMS.findIndex((item) => item.key === key);
    return { item: ITEMS[index] as AgendaListItem, index, isViewable: true };
  }),
});

// Uma lista de 2000 de conteúdo numa tela de 800: rola até 1200.
const MAX = 1200;

describe('mês em vista nos chips', () => {
  it('segue a rolagem enquanto ninguém toca num chip', () => {
    const { result } = renderHook(() => useMonthInView());
    act(() => result.current.onViewableItemsChanged(viewable('month-2026-11', 'event-vaqueiro')));
    expect(result.current.picked).toBe('2026-11');
  });

  it('o chip tocado fica até a chegada, mesmo com os meses do meio passando', () => {
    const { result } = renderHook(() => useMonthInView());

    let arrived: string | null = null;
    act(() => {
      arrived = result.current.pick('2026-12', 900);
    });
    expect(arrived).toBeNull();
    act(() => {
      arrived = result.current.onScroll(450, MAX);
    });
    act(() => result.current.onViewableItemsChanged(viewable('month-2026-11')));
    expect(arrived).toBeNull();
    expect(result.current.picked).toBe('2026-12');

    act(() => {
      arrived = result.current.onScroll(900, MAX);
    });
    expect(arrived).toBe('2026-12');
    // Um evento repetido na chegada não solta; a rolagem seguinte, sim.
    act(() => {
      result.current.onScroll(900.5, MAX);
    });
    expect(result.current.picked).toBe('2026-12');
    act(() => {
      result.current.onScroll(860, MAX);
    });
    expect(result.current.picked).toBe('2026-11');
  });

  it('perto do fim, a chegada é onde a lista para', () => {
    const { result } = renderHook(() => useMonthInView());
    act(() => {
      result.current.pick('2026-12', 1500);
    });
    let arrived: string | null = null;
    act(() => {
      arrived = result.current.onScroll(MAX, MAX);
    });
    expect(arrived).toBe('2026-12');
  });

  it('se a rolagem para antes (um toque a interrompeu), o fim dela conta como chegada', () => {
    const { result } = renderHook(() => useMonthInView());
    act(() => {
      result.current.pick('2026-12', 900);
      result.current.onScroll(300, MAX);
    });
    let arrived: string | null = null;
    act(() => {
      arrived = result.current.onScrollEnd();
    });
    expect(arrived).toBe('2026-12');
    // Sem trava, o fim de outra rolagem não diz nada.
    expect(result.current.onScrollEnd()).toBeNull();
  });

  it('com a lista já no lugar, ou sem para onde rolar, a chegada é na hora', () => {
    const { result } = renderHook(() => useMonthInView());
    let arrived: string | null = null;
    act(() => {
      arrived = result.current.pick('2026-10', 0);
    });
    expect(arrived).toBe('2026-10');
    act(() => {
      arrived = result.current.pick('2026-11', null);
    });
    expect(arrived).toBe('2026-11');
  });

  it('arrastar solta a trava na hora e volta ao mês em vista', () => {
    const { result } = renderHook(() => useMonthInView());
    act(() => result.current.onViewableItemsChanged(viewable('featured-irara')));
    act(() => {
      result.current.pick('2026-12', 900);
    });
    expect(result.current.picked).toBe('2026-12');
    act(() => result.current.release());
    expect(result.current.picked).toBe('2026-10');
  });
});
