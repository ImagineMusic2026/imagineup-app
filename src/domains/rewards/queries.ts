import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { sourceOf } from '@/config/data-source';
import { profileKeys, type Wallet } from '@/domains/profile';
import { t } from '@/i18n';
import { haptics } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';
import { formatPointsSpoken } from '@/utils/number';

import { fetchRewards, redeemReward } from './api';
import { outcomeUnknown, redeemFailure } from './describe-reward';
import type { RedeemResult, RedeemVariables, Reward, RewardsResponse } from './types';

/** A chave inclui tudo que muda o resultado. */
export const rewardKeys = {
  all: ['rewards'] as const,
  list: () => [...rewardKeys.all, 'list'] as const,
};

/**
 * Devolução vista pelo fã (25.12): a recusa acontece no painel, longe do app.
 * A loja que chega com um pedido recusado que devolveu pontos depois da última
 * gravação da carteira em cache faz a carteira buscar de novo, para a pílula
 * do saldo bater com "Os N pontos voltaram para o seu saldo". Os dois
 * instantes são do relógio do servidor (o `statusAt` da recusa e o
 * `updatedAt` da carteira, gravados no mesmo "agora"); o `dataUpdatedAt` do
 * React Query é do aparelho e não serve. A carteira em cache sem o campo
 * (salva antes do bloco 10) busca de novo, e volta com ele. Só com a API: nas
 * fixtures, a carteira de exemplo já conta a devolução.
 */
export function syncRefunds(queryClient: QueryClient, response: RewardsResponse): void {
  if (sourceOf('rewards') !== 'api') return;
  const wallet = queryClient.getQueryData<Wallet>(profileKeys.wallet());
  if (!wallet) return;
  const refunds = response.rewards.flatMap((reward) =>
    reward.redemptions.filter((item) => item.status === 'refused' && item.refundedPoints > 0),
  );
  if (refunds.length === 0) return;
  const updatedAt = wallet.updatedAt === undefined ? null : Date.parse(wallet.updatedAt ?? '');
  const stale =
    updatedAt === null ||
    Number.isNaN(updatedAt) ||
    refunds.some((item) => Date.parse(item.statusAt) > updatedAt);
  if (stale) void queryClient.invalidateQueries({ queryKey: profileKeys.wallet() });
}

function rewardsQueryOptions(queryClient: QueryClient) {
  return {
    queryKey: rewardKeys.list(),
    queryFn: async (): Promise<RewardsResponse> => {
      const response = await fetchRewards();
      syncRefunds(queryClient, response);
      return response;
    },
    ...queryOptionsFor('rewards'),
  };
}

/** A loja da 1h, na ordem do painel. Do servidor com o emulador (bloco 10), com rede e disco. */
export function useRewardsQuery() {
  const queryClient = useQueryClient();
  return useQuery(rewardsQueryOptions(queryClient));
}

/**
 * Uma recompensa da loja, para o detalhe do resgate: sai da mesma lista da 1h
 * (aberto a frio, busca a lista). `null` quando ela não está mais na loja.
 */
export function useRewardQuery(rewardId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    ...rewardsQueryOptions(queryClient),
    select: (data: RewardsResponse): Reward | null =>
      data.rewards.find((reward) => reward.id === rewardId) ?? null,
  });
}

/**
 * A tentativa de resgate em aberto: a chave e o custo que ela mandou (25.5), os
 * pedidos que a recompensa já tinha quando ela abriu e se ela está indo.
 */
interface Attempt {
  key: string;
  expectedCost: number;
  knownCodes: ReadonlySet<string>;
  pending: boolean;
}

/**
 * A tentativa de resgate em aberto, por fã e recompensa, fora da tela. Nasce
 * na primeira tentativa e sai com uma resposta clara: o sucesso ou uma recusa
 * definitiva (saldo, esgotado, limite, custo mudado, fora da loja). Assim,
 * depois de uma falha de resultado incerto (rede, prazo, 5xx), fechar e
 * reabrir a sheet e confirmar de novo leva a mesma chave, e um segundo toque
 * que escape da trava também: se o servidor gravou antes de a resposta se
 * perder, ele não gasta duas vezes. A tentativa guarda também o custo que
 * mandou e repete o mesmo corpo, mesmo que a confirmação mostre outro custo:
 * o servidor devolve o resultado guardado (se gravou) ou recusa com
 * `reward_changed` (se não gravou), e a chave nunca é trocada às cegas
 * (25.5). Volta ao início quando o app reabre.
 *
 * A loja também responde: quando ela mostra um pedido desta recompensa que
 * não existia quando a tentativa abriu, e nada está indo, a tentativa gravou
 * (`attemptRecorded`). A confirmação aberta volta ao detalhe com o pedido à
 * vista, e a confirmação seguinte fecha a tentativa (`closeRecordedAttempt`):
 * o resgate novo, escolhido com o pedido à vista, leva chave nova, em vez de
 * repetir a resposta guardada do pedido antigo (25.12).
 */
const openAttempts = new Map<string, Attempt>();

function attemptSlot(uid: string, rewardId: string): string {
  return `${uid}/${rewardId}`;
}

function attemptFor(slot: string, confirmedCost: number, knownCodes: readonly string[]): Attempt {
  const open = openAttempts.get(slot);
  if (open) return open;
  const attempt: Attempt = {
    key: createIdempotencyKey(),
    expectedCost: confirmedCost,
    knownCodes: new Set(knownCodes),
    pending: false,
  };
  openAttempts.set(slot, attempt);
  return attempt;
}

/** A tentativa aberta, parada, cujo pedido a loja já mostra. */
function recordedAttempt(slot: string, reward: Reward): Attempt | null {
  const open = openAttempts.get(slot);
  if (!open || open.pending) return null;
  return reward.redemptions.some((item) => !open.knownCodes.has(item.code)) ? open : null;
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
 * tentativa (`openAttempts`), não da chamada, e a confirmação manda o custo que
 * congelou ao abrir (`confirmedCost`).
 *
 * No sucesso, o saldo novo da resposta entra direto na carteira (a pílula da
 * 1h e a da sheet contam para baixo na hora), e a carteira (com o progresso e
 * o extrato, debaixo dela) e a loja buscam de novo (a loja traz o código, as
 * instruções e o status em `redemptions`). O resgate não mexe em XP,
 * temporada, centrais, missões nem conquistas: nada disso busca de novo.
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

  const refreshWallet = () =>
    void queryClient.invalidateQueries({ queryKey: profileKeys.wallet() });
  const refreshShop = () => void queryClient.invalidateQueries({ queryKey: rewardKeys.all });
  const slot = attemptSlot(uid, rewardId);
  // Os pedidos que a loja em cache mostra nesta recompensa: os que a tentativa já conhece.
  const shownCodes = (): string[] =>
    queryClient
      .getQueryData<RewardsResponse>(rewardKeys.list())
      ?.rewards.find((reward) => reward.id === rewardId)
      ?.redemptions.map((item) => item.code) ?? [];

  const mutation = useMutation<RedeemResult, Error, RedeemVariables>({
    mutationFn: (variables) => redeemReward(variables),
    networkMode: 'always',
    retry: false,
    onSuccess: (result, variables) => {
      openAttempts.delete(attemptSlot(uid, variables.rewardId));
      queryClient.setQueryData<Wallet>(profileKeys.wallet(), (wallet) =>
        wallet ? { ...wallet, balance: result.balance } : wallet,
      );
      refreshWallet();
      refreshShop();
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
          refreshWallet();
          haptics.trigger('insufficientPoints');
          break;
        case 'soldOut':
        case 'notFound':
        case 'changed':
          // A loja passa a mostrar o esgotado ou o custo novo.
          refreshShop();
          haptics.trigger('warning');
          break;
        case 'limitReached':
          // O pedido que fechou o limite veio de outra sessão do fã (outro aparelho,
          // outra aba) e gastou saldo: a loja mostra o pedido, e a carteira, o saldo.
          refreshWallet();
          refreshShop();
          haptics.trigger('warning');
          break;
        case 'alreadyRedeemed':
          // A chave já gravou um pedido: o pedido aparece na loja, e o saldo cai.
          refreshWallet();
          refreshShop();
          haptics.trigger('warning');
          break;
        case 'dailyLimit':
          haptics.trigger('error');
          break;
        default:
          refreshWallet();
          refreshShop();
          haptics.trigger('error');
      }
      if (!mounted.current) announce(t(`rewards.errors.${failure}`));
    },
    onSettled: (_result, _error, variables) => {
      inFlight.current = false;
      const open = openAttempts.get(attemptSlot(uid, variables.rewardId));
      if (open?.key === variables.idempotencyKey) open.pending = false;
    },
  });

  return {
    ...mutation,
    /**
     * `confirmedCost` é o custo que a confirmação congelou ao abrir; com uma
     * tentativa aberta, vai o custo dela. `callbacks` só rodam com a tela
     * montada (o passo da sheet); o resto roda sempre.
     */
    redeem: (confirmedCost: number, callbacks?: RedeemCallbacks) => {
      if (inFlight.current) return;
      inFlight.current = true;
      const attempt = attemptFor(slot, confirmedCost, shownCodes());
      attempt.pending = true;
      mutation.mutate(
        { rewardId, idempotencyKey: attempt.key, expectedCost: attempt.expectedCost },
        callbacks,
      );
    },
    /**
     * A tentativa aberta já gravou: a loja mostra um pedido desta recompensa
     * que não existia quando ela abriu (a resposta se perdeu, e o servidor
     * gravou), e nada está indo.
     */
    attemptRecorded: (reward: Reward): boolean => recordedAttempt(slot, reward) !== null,
    /**
     * Uma confirmação nova, aberta com o pedido da tentativa à vista: a
     * tentativa fecha, e o resgate seguinte é um pedido novo, com chave nova.
     * A confirmação que já estava aberta não passa por aqui, e o toque nela
     * repete a chave (e a resposta guardada).
     */
    closeRecordedAttempt: (reward: Reward): void => {
      if (recordedAttempt(slot, reward)) openAttempts.delete(slot);
    },
  };
}

export interface RedeemCallbacks {
  onSuccess?: (result: RedeemResult) => void;
  onError?: (error: Error) => void;
}
