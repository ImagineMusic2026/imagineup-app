import { useCallback, useState } from 'react';

import { useCheckin, type CheckinView } from './use-checkin';

export interface CheckinPanel extends CheckinView {
  /** O card do check-in aberto embaixo da saudação. Nasce fechado. */
  open: boolean;
  /** O toque no ícone do calendário: abre ou fecha o card. */
  toggle: () => void;
  close: () => void;
}

/**
 * O check-in da Início (seção 40, desenho do dono de 25/11/2026): o ícone do
 * calendário no topo, que pulsa com a bolinha enquanto o de hoje está por
 * fazer, e o card que ele abre e fecha. O card nasce fechado a cada abertura
 * da tela, e o ícone e o card leem o mesmo estado. Sem estado (carregando, a
 * chave desligada, a `api` de antes ou o dia virado), o card fecha: o de
 * amanhã chega fechado, com o ícone pulsando de novo.
 */
export function useCheckinPanel(): CheckinPanel {
  const view = useCheckin();
  const [open, setOpen] = useState(false);
  if (!view.state && open) setOpen(false);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);

  return { ...view, open, toggle, close };
}
