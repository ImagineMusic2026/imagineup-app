import { useCallback, useRef, useState } from 'react';

import { monthInView, type ViewableAgendaItem } from '../group-by-month';

// O nativo arredonda a rolagem: um ponto de diferença ainda é "chegou".
const ARRIVAL_TOLERANCE = 1;

interface Pin {
  month: string;
  /** Onde a rolagem pedida pelo chip para (a sobrelinha do mês logo abaixo dos chips). */
  destination: number | null;
  /** Onde ela parou; `null` enquanto anda. */
  arrivedAt: number | null;
}

/**
 * Mês escolhido nos chips da agenda (1m). Segue a rolagem: é o mês do
 * primeiro item à vista. Depois de um toque no chip, fica no mês tocado
 * enquanto a lista rola até ele, para a rolagem não passar pelos meses do
 * meio nem voltar ao mês de cima quando o fim da lista não deixa o mês tocado
 * chegar ao topo.
 *
 * A trava sai quando a rolagem seguinte começa, depois da chegada: arrasto
 * com o dedo, gesto de rolar do TalkBack ou do VoiceOver, foco do leitor de
 * tela andando pelos shows. Só o arrasto tem evento próprio
 * (`onScrollBeginDrag`, que solta na hora); o resto só aparece como rolagem,
 * e por isso a chegada precisa ser conhecida.
 *
 * `pick`, `onScroll` e `onScrollEnd` devolvem o mês quando a rolagem até ele
 * termina, para a tela levar o foco do leitor de tela até lá.
 */
export function useMonthInView() {
  const [picked, setPicked] = useState<string | null>(null);
  const pin = useRef<Pin | null>(null);
  const viewable = useRef<readonly ViewableAgendaItem[]>([]);
  const offset = useRef(0);

  // A FlashList guarda a função da primeira renderização: ela precisa ser estável.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewableAgendaItem[] }) => {
      viewable.current = viewableItems;
      if (pin.current) return;
      const month = monthInView(viewableItems);
      if (month) setPicked(month);
    },
    [],
  );

  /** Volta a seguir a rolagem, a partir do que está à vista agora. */
  const release = (): void => {
    if (!pin.current) return;
    pin.current = null;
    const month = monthInView(viewable.current);
    if (month) setPicked(month);
  };

  const arrive = (current: Pin, at: number): string => {
    current.arrivedAt = at;
    return current.month;
  };

  /**
   * Toque num chip. `destination` é onde a lista vai parar, já limitada ao
   * fim dela (`null`: não vai rolar); se ela já está lá, devolve o mês na hora.
   */
  const pick = (month: string, destination: number | null): string | null => {
    const current: Pin = { month, destination, arrivedAt: null };
    pin.current = current;
    setPicked(month);
    if (destination !== null && Math.abs(offset.current - destination) > ARRIVAL_TOLERANCE) {
      return null;
    }
    return arrive(current, offset.current);
  };

  /** Cada evento de rolagem da lista; `maxOffset` é o fim dela agora. */
  const onScroll = (y: number, maxOffset: number): string | null => {
    offset.current = y;
    const current = pin.current;
    if (!current) return null;
    if (current.arrivedAt !== null) {
      if (Math.abs(y - current.arrivedAt) > ARRIVAL_TOLERANCE) release();
      return null;
    }
    // A lista pode ter crescido ou encolhido no caminho.
    const end = Math.min(current.destination ?? y, Math.max(0, maxOffset));
    if (Math.abs(y - end) > ARRIVAL_TOLERANCE) return null;
    return arrive(current, y);
  };

  /**
   * A rolagem parou (fim da animação, ou um toque que a interrompeu): conta
   * como chegada, mesmo longe do destino.
   */
  const onScrollEnd = (): string | null => {
    const current = pin.current;
    if (!current || current.arrivedAt !== null) return null;
    return arrive(current, offset.current);
  };

  return { picked, pick, release, onScroll, onScrollEnd, onViewableItemsChanged };
}
