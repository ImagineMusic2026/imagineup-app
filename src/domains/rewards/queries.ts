import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { profileKeys, type Wallet } from '@/domains/profile';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';
import { formatPointsSpoken } from '@/utils/number';

import { fetchRewards, redeemReward } from './api';
import { outcomeUnknown, redeemFailure } from './describe-reward';
import type { RedeemResult, RedeemVariables, Reward } from './types';

/** A chave inclui tudo que muda o resultado. */
export const rewardKeys = {
  all: ['rewards'] as const,
  list: () => [...rewardKeys.all, 'list'] as const,
};

/** A loja da 1h, na ordem do painel. */
export function useRewardsQuery() {
  return useQuery({
    queryKey: rewardKeys.list(),
    queryFn: fetchRewards,
  });
}

/**
 * Uma recompensa da loja, para o detalhe do resgate: sai da mesma lista da 1h
 * (aberto a frio, busca a lista). `null` quando ela não está mais na loja.
 */
export function useRewardQuery(rewardId: string) {
  return useQuery({
    queryKey: rewardKeys.list(),
    queryFn: fetchRewards,
    select: (data): Reward | null => data.rewards.find((reward) => reward.id === rewardId) ?? null,
  });
}

/**
 * A chave da tentativa de resgate em aberto, por fã e recompensa, fora da
 * tela. Nasce na primeira tentativa e só sai com uma resposta clara: o
 * sucesso ou uma recusa definitiva (saldo, esgotado, fora da loja). Assim,
 * depois de uma falha de resultado incerto (rede, prazo, 5xx), fechar e
 * reabrir a sheet e confirmar de novo leva a mesma chave, e um segundo toque
 * que escape da trava também: se o servidor gravou antes de a resposta se
 * perder, ele não gasta duas vezes. Volta ao início quando o app reabre.
 */
const openAttempts = new Map<string, string>();

function attemptSlot(uid: string, rewardId: string): string {
  return `${uid}/${rewardId}`;
}

function attemptKey(slot: string): string {
  const open = openAttempts.get(slot);
  if (open) return open;
  const key = createIdempotencyKey();
  openAttempts.set(slot, key);
  return key;
}

function announce(message: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

/**
 * Resgate de uma recompensa. Não é otimista e não entra na fila offline:
 * gastar saldo não pode acontecer horas depois, e o fã espera a resposta para
 * ver as instruções. Sem rede, o erro aparece na hora (como entrar e seguir as
 * centrais); a tela desliga o botão offline.
 *
 * Um toque só por vez: a trava é síncrona, porque o botão só vira "carregando"
 * no render seguinte, e dois toques no mesmo quadro (JS ocupado, ativação
 * dupla do leitor de tela) viravam dois resgates. A chave de idempotência é da
 * tentativa (`openAttempts`), não da chamada.
 *
 * No sucesso, o saldo novo da resposta entra direto na carteira (a pílula da
 * 1h e a da sheet contam para baixo na hora), e a carteira, o perfil e a loja
 * buscam de novo (a loja traz o código e as instruções em `redemptions`).
 * Depois de uma falha incerta, a carteira e a loja também buscam de novo: o
 * resgate pode ter sido gravado. O toque sai daqui sempre; o anúncio, só com a
 * sheet já fechada (o arrasto do Android não trava): aberta, é ela que leva o
 * foco a quem diz o resultado, e um anúncio aqui seria cortado por esse foco.
 */
export function useRedeemRewardMutation(rewardId: string) {
  const queryClient = useQueryClient();
  const uid = useSessionStore((state) => state.user?.uid ?? '');
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation<RedeemResult, Error, RedeemVariables>({
    mutationFn: (variables) => redeemReward(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: (result, variables) => {
      openAttempts.delete(attemptSlot(uid, variables.rewardId));
      queryClient.setQueryData<Wallet>(profileKeys.wallet(), (wallet) =>
        wallet ? { ...wallet, balance: result.balance } : wallet,
      );
      void queryClient.invalidateQueries({ queryKey: profileKeys.all });
      void queryClient.invalidateQueries({ queryKey: rewardKeys.all });
      haptics.trigger('redeem');
      if (!mounted.current) {
        announce(
          t('rewards.success.announcement', { balance: formatPointsSpoken(result.balance) }),
        );
      }
    },
    onError: (error, variables) => {
      const failure = redeemFailure(error);
      if (!outcomeUnknown(error)) openAttempts.delete(attemptSlot(uid, variables.rewardId));
      switch (failure) {
        case 'insufficientPoints':
          // O saldo em cache estava velho: a tela passa a mostrar o que falta.
          void queryClient.invalidateQueries({ queryKey: profileKeys.wallet() });
          haptics.trigger('insufficientPoints');
          break;
        case 'soldOut':
        case 'notFound':
          void queryClient.invalidateQueries({ queryKey: rewardKeys.all });
          haptics.trigger('warning');
          break;
        default:
          void queryClient.invalidateQueries({ queryKey: profileKeys.wallet() });
          void queryClient.invalidateQueries({ queryKey: rewardKeys.all });
          haptics.trigger('error');
      }
      if (!mounted.current) announce(t(`rewards.errors.${failure}`));
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  return {
    ...mutation,
    /** `callbacks` só rodam com a tela montada (o passo da sheet); o resto roda sempre. */
    redeem: (callbacks?: RedeemCallbacks) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const idempotencyKey = attemptKey(attemptSlot(uid, rewardId));
      mutation.mutate({ rewardId, idempotencyKey }, callbacks);
    },
  };
}

export interface RedeemCallbacks {
  onSuccess?: (result: RedeemResult) => void;
  onError?: (error: Error) => void;
}
