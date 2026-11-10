import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

// Os outros domínios pelos arquivos, fora do index: o index do perfil puxa o
// Firebase e fecharia um ciclo (a 1e, que ele exporta, importa este domínio),
// e o das missões e o do ranking puxam telas.
import { rewardsRefresh } from '@/domains/missions/describe-rewards';
import { missionKeys } from '@/domains/missions/queries';
import { rewardsToast } from '@/domains/profile/action-rewards';
import { profileKeys } from '@/domains/profile/keys';
import { refreshRanking } from '@/domains/ranking/queries';
import { t, type TranslationKey } from '@/i18n';
import { ApiError } from '@/services/api/errors';
import { haptics, type HapticEvent } from '@/services/haptics';
import { queryOptionsFor } from '@/services/query/client';
import { alertActionRefusal } from '@/services/refusal-alert';
import { useSessionStore } from '@/stores/session';
import { createIdempotencyKey } from '@/utils/id';

import { doCheckin, fetchCheckin } from './api';
import {
  checkinAnnouncement,
  checkinRefusal,
  isCheckinUnavailable,
  isMissingRoute,
} from './describe-checkin';
import { checkinKeys, checkinMutationKeys } from './keys';
import type { CheckinResult, CheckinState, CheckinVariables } from './types';

/**
 * A trava da `api` de antes do check-in, em função da consulta e fora do
 * render: quem resolve é o Query, a cada busca que ia sair (a tela que monta,
 * o puxar para atualizar, a volta do app para a frente e a da rede). Lida do
 * cache durante o render, o React Compiler guardava a primeira leitura, e a
 * Início, que monta antes da resposta, seguia perguntando a cada puxão.
 */
const routeExists = (query: Query<CheckinState, Error>): boolean =>
  !isMissingRoute(query.state.error);

/**
 * O estado do check-in diário (`GET /me/checkin`), fora do disco: o "feito
 * hoje" e a chave ligada de uma abertura não podem aparecer na seguinte,
 * depois de o dia virar ou de a chave ser desligada. Com a `api` de antes do
 * check-in (o 404 de rota que não existe), a consulta não pergunta de novo
 * nesta abertura do app (`routeExists`): quem recebeu o 404 só volta a
 * perguntar com o app reaberto ou a conta trocada, mesmo com as funções novas
 * já publicadas, e por isso elas vão ao ar antes do app. Só o 404 trava:
 * outra recusa definitiva (um 401, um 403) esconde o card enquanto for o erro
 * da consulta (`liveCheckin`), e a busca seguinte pergunta de novo. A chave
 * desligada é uma resposta que deu certo (`enabled: false`): o retrato de 1
 * min, a volta do app para a frente e o puxar para atualizar a veem ligar.
 */
export function useCheckinQuery() {
  const options = queryOptionsFor('checkin');
  return useQuery({
    ...options,
    queryKey: checkinKeys.state(),
    queryFn: fetchCheckin,
    enabled: routeExists,
    meta: { ...options.meta, persist: false },
  });
}

/** O "+N" do check-in, para o `PointsToast`. */
export interface CheckinAward {
  /** Muda a cada ganho: dispara o "+N". */
  id: number;
  points: number;
  /** A frase do check-in e de tudo o que ele rendeu (pontos, nível, conquistas). */
  announcement?: string;
  haptic?: HapticEvent;
}

/**
 * Falha de resultado incerto (rede, prazo, servidor): o servidor pode ter
 * gravado o check-in, e a nova tentativa leva a mesma chave.
 */
function isUncertainFailure(error: unknown): boolean {
  return !(error instanceof ApiError) || error.isRetryable;
}

/** A sessão que pediu, guardada no `onMutate`. */
type StartedBy = { uid: string | null };

const sessionUid = (): string | null => useSessionStore.getState().user?.uid ?? null;

/** O `onMutate`: quem pediu, na hora do pedido (e não a do último render). */
const startedBy = (): StartedBy => ({ uid: sessionUid() });

/** A sessão que pediu ainda é a de agora: a resposta de outra não vai ao cache do fã seguinte. */
const sameSession = (started: StartedBy | undefined): boolean => started?.uid === sessionUid();

/** A tentativa aberta: a chave e o dia do check-in (o `resetsAt` do estado) em que ela nasceu. */
interface Attempt {
  key: string;
  day: string;
}

/**
 * "Fazer check-in" (`POST /me/checkin`). Não é otimista e não entra na fila
 * offline: o check-in guardado na fila cairia noutro dia, então o botão fica
 * carregando até a resposta e desligado sem internet (`networkMode: 'always'`,
 * sem tentar de novo sozinha). Um toque só por vez (a trava síncrona barra o
 * segundo, que chega antes de o botão virar "carregando"), com a chave da
 * tentativa: a mesma depois de uma falha incerta no mesmo dia, nova depois de
 * uma recusa ou com o dia virado (a resposta guardada de ontem não é a de
 * hoje).
 *
 * No sucesso, o estado novo entra no cache na hora (o card encolhe para o
 * "Check-in feito"), por cima da busca do estado que ainda estivesse indo,
 * cancelada antes: ela saiu antes do toque e traria o estado de antes. A
 * resposta de um toque perto da meia-noite de São Paulo que chega depois da
 * virada traz o dia que acabou (o prazo dela já passou): o estado de hoje
 * busca de novo na hora, porque o cancelamento levou junto a busca que a
 * virada tinha pedido. Os pontos sobem no "+N" do `award`, para o `PointsToast`, que dá o toque e o
 * anúncio do check-in e de tudo o que ele rendeu; sem pontos (o segundo toque
 * do dia), só o anúncio, na fila. O saldo nunca é escrito aqui: com pontos, a
 * carteira (com o nível e o extrato) e o ranking buscam de novo; as missões e
 * as conquistas, pelo que a resposta disser (`rewardsRefresh`).
 *
 * Na falha, o toque de erro e a frase, anunciada na fila e mostrada embaixo
 * do botão (`failure`). Depois da falha incerta (rede, prazo, 5xx), a
 * carteira busca de novo, porque o servidor pode ter gravado, no molde do
 * seguir do fã-clube e do resgate; o estado do check-in fica como está, para
 * o novo toque repetir a chave e festejar com a resposta guardada, e o
 * ranking fica com o `staleTime` dele. O check-in fora do ar (a chave
 * desligada, 409 `checkin_disabled`, ou a `api` de antes, 404) faz o estado
 * buscar de novo, e o card some. A conta suspensa segue o caminho de sempre:
 * o `Alert` "Conta suspensa" do `MutationCache`, e então sem anúncio.
 */
export function useCheckinMutation() {
  const client = useQueryClient();
  const [award, setAward] = useState<CheckinAward | null>(null);
  const awards = useRef(0);
  const attempt = useRef<Attempt | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const mutation = useMutation<CheckinResult, Error, CheckinVariables, StartedBy>({
    mutationKey: checkinMutationKeys.checkin,
    mutationFn: doCheckin,
    networkMode: 'always',
    retry: false,
    onMutate: startedBy,
    onSuccess: (result, _variables, started) => {
      attempt.current = null;
      if (!sameSession(started)) return;
      // A busca que saiu antes do toque leu o estado de antes: chegando depois, reabriria o card.
      void client.cancelQueries({ queryKey: checkinKeys.state() });
      client.setQueryData<CheckinState>(checkinKeys.state(), result.checkin);
      // A resposta sem um estado legível: quem diz o que vale é o servidor. E a
      // que chega depois da virada do dia traz o dia que acabou: o de hoje busca de novo.
      if (!result.checkin.enabled || Date.parse(result.checkin.resetsAt) <= Date.now()) {
        void client.invalidateQueries({ queryKey: checkinKeys.state() });
      }
      const refresh = rewardsRefresh(result);
      if (refresh.missions) void client.invalidateQueries({ queryKey: missionKeys.all });
      if (refresh.achievements) {
        void client.invalidateQueries({ queryKey: profileKeys.achievements() });
      }
      if (result.pointsAwarded > 0) {
        void client.invalidateQueries({ queryKey: profileKeys.wallet() });
        refreshRanking(client);
      }
      // Chegou com a tela fechada: só o cache. A festa fica para quem estiver à vista.
      if (!mounted.current) return;
      const done = result.checkin.checkedInToday ? checkinAnnouncement(result.checkin) : null;
      // Sem pontos não há "+N": o botão que tinha o foco sumiu, e o fã ouve o resultado.
      if (done && result.pointsAwarded <= 0) {
        AccessibilityInfo.announceForAccessibilityWithOptions(done, { queue: true });
      }
      const toast = rewardsToast(result.pointsAwarded, result);
      if (!toast) return;
      awards.current += 1;
      setAward({
        id: awards.current,
        points: result.pointsAwarded,
        announcement: [done, toast.announcement].filter(Boolean).join(' ') || undefined,
        haptic: toast.haptic,
      });
    },
    onError: (error) => {
      if (isUncertainFailure(error)) {
        // O servidor pode ter gravado: a carteira busca de novo. O estado do
        // check-in fica como está, para o novo toque levar a mesma chave,
        // receber a resposta guardada e festejar.
        void client.invalidateQueries({ queryKey: profileKeys.wallet() });
      } else {
        attempt.current = null;
      }
      if (isCheckinUnavailable(error)) {
        void client.invalidateQueries({ queryKey: checkinKeys.state() });
      }
      const refusal = checkinRefusal(error);
      // O "Conta suspensa" já abriu, ou não, no `SuspensionWatcher` (o `MutationCache` roda antes).
      const alerted = alertActionRefusal(refusal.type, 'checkin');
      if (!mounted.current) return;
      haptics.trigger('error');
      if (alerted) return;
      AccessibilityInfo.announceForAccessibilityWithOptions(t(refusal.key), { queue: true });
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  const checkin = (): void => {
    if (inFlight.current) return;
    const day = client.getQueryData<CheckinState>(checkinKeys.state())?.resetsAt ?? '';
    let current = attempt.current;
    if (!current || current.day !== day) {
      current = { key: `checkin-${createIdempotencyKey()}`, day };
      attempt.current = current;
    }
    inFlight.current = true;
    mutation.mutate({ idempotencyKey: current.key });
  };

  const failure: TranslationKey | null = mutation.isError
    ? checkinRefusal(mutation.error).key
    : null;

  return { checkin, award, isPending: mutation.isPending, failure };
}
