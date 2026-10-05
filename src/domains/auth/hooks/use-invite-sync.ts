import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AppState } from 'react-native';

import { subscribePendingInvite } from '@/domains/invites';
import { useSessionStore } from '@/stores/session';

import { INVITE_SYNC_RETRY_MS } from '../consts';
import { runInviteSyncRound } from '../invite-sync';

// Uma rodada por vez no app inteiro: um pedido de rodada que chega no meio de
// outra roda logo depois dela, uma vez só.
let running: Promise<void> | null = null;
let queued: (() => void) | null = null;

function schedule(round: () => Promise<void>): void {
  if (running) {
    queued = () => schedule(round);
    return;
  }
  running = round().finally(() => {
    running = null;
    const next = queued;
    queued = null;
    next?.();
  });
}

/**
 * Manda o convite da conta da sessão (docs/arquitetura-api.md, 20.11). Roda
 * com a sessão confirmada e ninguém segurando as telas de conta (o cadastro
 * amarra o convite ao uid e só depois solta); de novo quando a rede volta,
 * quando um convite novo é guardado e quando o app volta ao primeiro plano.
 * Falha de resultado incerto põe até 3 novas rodadas na mesma sessão (30 s,
 * 2 min e 10 min), canceladas quando a sessão muda. Chamado no `_layout.tsx`
 * raiz, logo depois do `useAuthListener`.
 */
export function useInviteSync(): void {
  const uid = useSessionStore((state) =>
    state.status === 'signedIn' ? (state.user?.uid ?? null) : null,
  );
  const held = useSessionStore((state) => state.authHolds > 0);

  useEffect(() => {
    if (!uid || held) return undefined;
    let cancelled = false;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const retryLater = (): void => {
      if (cancelled || timer || attempt >= INVITE_SYNC_RETRY_MS.length) return;
      const delay = INVITE_SYNC_RETRY_MS[attempt]!;
      attempt += 1;
      timer = setTimeout(() => {
        timer = null;
        run();
      }, delay);
    };

    const run = (): void => {
      if (cancelled) return;
      schedule(async () => {
        if (cancelled) return;
        const outcome = await runInviteSyncRound(uid).catch(() => 'retry' as const);
        if (outcome === 'retry') retryLater();
      });
    };

    run();
    const offOnline = onlineManager.subscribe((online) => {
      if (online) run();
    });
    const offPending = subscribePendingInvite(run);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      offOnline();
      offPending();
      appState.remove();
    };
  }, [uid, held]);
}
