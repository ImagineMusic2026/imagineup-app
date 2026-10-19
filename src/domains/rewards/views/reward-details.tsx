import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  AccessibilityInfo,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput as NativeTextInput,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/empty-state';
import { BackButton } from '@/components/header';
import { PointsPill } from '@/components/points-pill';
import { SheetGrabber } from '@/components/sheet-grabber';
import { useMyContactQuery, useWalletQuery } from '@/domains/profile';
import { useAnnounceWhen } from '@/hooks/use-announce-when';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t } from '@/i18n';
import { colors, motion, spacing } from '@/theme';
import { maskWhatsapp, parseWhatsapp, whatsappFieldValue } from '@/utils/whatsapp';

import {
  ConfirmActions,
  ConfirmBody,
  DetailsActions,
  DetailsBody,
  DetailsSkeleton,
  SuccessActions,
  SuccessBody,
  type RedeemStep,
} from '../components/redeem-steps';
import { redeemFailure, rewardAvailability, type RedeemFailure } from '../describe-reward';
import { useRedeemRewardMutation, useRewardQuery } from '../queries';
import type { Reward } from '../types';

const isIOS = Platform.OS === 'ios';

/** O erro do campo do WhatsApp: vazio, ou fora do formato (o do app ou a recusa do servidor). */
type WhatsappError = 'required' | 'invalid';

const WHATSAPP_ERRORS = {
  required: 'rewards.confirm.whatsapp.required',
  invalid: 'rewards.confirm.whatsapp.invalid',
} as const;

function announce(message: string): void {
  AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
}

/**
 * Aberta a frio (link), sem a 1h embaixo, a sheet volta para ela, com a 1f
 * embaixo na pilha da Ranking (a âncora): sem ela, a pilha nascia só com a 1h,
 * o voltar caía no Início e a aba Ranking não chegava mais à 1f.
 */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/recompensas', { withAnchor: true });
}

/**
 * "Ver missões" fecha a sheet e abre as missões na pilha da Ranking, por
 * cima da 1h: o voltar das missões devolve o fã à loja.
 */
function goToMissions(): void {
  if (!router.canGoBack()) {
    router.replace('/missoes', { withAnchor: true });
    return;
  }
  router.back();
  router.push('/missoes');
}

/**
 * Quando `key` muda (o passo, a recompensa que chegou depois de um erro), o
 * conteúdo novo entra em fade; quando ele termina, o foco do leitor de tela
 * vai para `target` (o botão que o fã tocou saiu da tela). A abertura da sheet
 * não conta: o leitor começa por ela sozinho.
 */
function useFocusOnChange(key: string, target: RefObject<View | null>): void {
  const shown = useRef(key);

  useEffect(() => {
    if (shown.current === key) return;
    shown.current = key;
    const timer = setTimeout(() => {
      if (target.current) AccessibilityInfo.sendAccessibilityEvent(target.current, 'focus');
    }, motion.duration.base);
    return () => clearTimeout(timer);
  }, [key, target]);
}

/**
 * Detalhe do resgate (sem desenho no protótipo, no visual das outras telas;
 * aprovado em 2026-09-29), numa sheet sobre as abas, como o convite. Três
 * passos: o detalhe com o custo e o saldo depois, a confirmação (com o
 * WhatsApp do fã, seção 35) e as instruções que o servidor devolve (retirada
 * com o código ou contato da equipe). O app pede só o WhatsApp, para a equipe
 * combinar a entrega; o endereço, quando a entrega pede, a equipe combina por
 * ele. Resgate é por pontos do saldo; o nível não cai. Os resgates que o fã
 * já fez voltam no detalhe, com o código e as instruções.
 *
 * O WhatsApp vem preenchido com o número guardado (`GET /me/contact`, buscado
 * ao abrir a sheet, fora do disco) e é editável, com a máscara. Até o fã
 * mexer, o campo segue o número guardado (que pode chegar depois de a
 * confirmação abrir); depois, o que ele digitou. Vazio ou fora do formato, a
 * confirmação não sai: o erro aparece no campo, que recebe o foco, e é
 * anunciado. A recusa do número pelo servidor volta ao mesmo campo, sem sair
 * da confirmação. Com uma tentativa aberta (a falha sem resposta clara), o
 * campo mostra o número dela, sem edição.
 *
 * Sem saldo, o botão diz quanto falta e "Ver missões" fecha o ciclo com a
 * 1g. Sem internet, o resgate fica desligado (não entra em fila). Enquanto o
 * resgate está indo, o voltar do Android e o gesto do iOS ficam presos; o
 * arrasto da sheet no Android não (o react-native-screens 4.26 ignora
 * `gestureEnabled` ali), e o resultado fica no detalhe da recompensa.
 *
 * Quando o passo muda por uma resposta do servidor, o foco vai para quem diz
 * o resultado: o título do sucesso (com o saldo novo) ou o aviso da recusa, no
 * pé, junto do botão. Um anúncio à parte seria cortado por esse foco.
 *
 * Bloco 10: a confirmação congela o custo ao abrir (`confirmedCost`) e manda
 * esse número, e não o da recompensa ao vivo, que uma busca de fundo troca em
 * silêncio; com a confirmação aberta e nada indo, o pedido da tentativa que
 * falhou sem resposta (o servidor gravou), o custo novo, o limite atingido, o
 * saldo que não cobre ou o esgotado voltam ao detalhe com o aviso.
 * Os pedidos do fã aparecem no detalhe com o status (solicitado, aprovado,
 * entregue ou recusado, com o motivo e os pontos de volta).
 */
export function RewardDetailsScreen() {
  const { recompensaId } = useLocalSearchParams<{ recompensaId?: string }>();
  const rewardId = recompensaId ?? '';
  const insets = useSafeAreaInsets();
  // Aberta a frio (link), a sheet é a única tela da pilha e ocupa a tela toda:
  // sem cantos nem puxador, e o topo desce abaixo da barra de status.
  const [standalone] = useState(() => !router.canGoBack());
  const online = useIsOnline();
  const query = useRewardQuery(rewardId);
  const wallet = useWalletQuery();
  const balance = wallet.data?.balance ?? null;
  const walletFailed = wallet.data === undefined && wallet.errorUpdateCount > 0;
  const redeem = useRedeemRewardMutation(rewardId);
  const contact = useMyContactQuery();
  const [step, setStep] = useState<RedeemStep>('details');
  // O que o fã digitou no campo do WhatsApp; `null` até ele mexer (vale o guardado).
  const [typedWhatsapp, setTypedWhatsapp] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<WhatsappError | null>(null);
  const whatsappRef = useRef<NativeTextInput>(null);
  // O campo recusado pede o foco, que só vem depois do render: durante o envio
  // ele estava travado (`editable` falso), e o campo desligado não recebe foco.
  const whatsappFocus = useRef(false);
  const [failure, setFailure] = useState<RedeemFailure | null>(null);
  // O custo que a confirmação mostra e manda, congelado ao entrar nela (25.12).
  const [confirmedCost, setConfirmedCost] = useState<number | null>(null);
  // A recompensa como estava no resgate: a loja busca de novo depois dele.
  const [redeemed, setRedeemed] = useState<Reward | null>(null);
  // "Tentar de novo" buscando: sem dado, a busca tira a consulta do erro, e o
  // botão (com o foco do leitor de tela) sumiria no lugar do esqueleto.
  const [retrying, setRetrying] = useState(false);
  const [recoveries, setRecoveries] = useState(0);
  const heading = useRef<View>(null);
  const notice = useRef<View>(null);
  const pending = redeem.isPending;
  const lockedWhatsapp = redeem.attemptWhatsapp();
  const whatsappValue =
    lockedWhatsapp !== null
      ? whatsappFieldValue(lockedWhatsapp)
      : (typedWhatsapp ?? whatsappFieldValue(contact.data?.whatsapp));
  // O "informe" sai sozinho quando o número guardado chega depois do toque.
  const shownWhatsappError =
    whatsappError === 'required' && whatsappValue.trim() !== '' ? null : whatsappError;
  const reward = query.data;
  const availability = reward ? rewardAvailability(reward, balance) : null;
  const refusal = failure === 'failed' ? null : failure;

  // A loja ou a carteira buscou de novo com a confirmação aberta e nada indo:
  // a tentativa que falhou sem resposta gravou (a loja mostra o pedido dela),
  // esgotou, o fã chegou ao limite, o saldo não cobre mais ou o custo mudou.
  // Volta ao detalhe, que diz o que mudou, com o mesmo aviso da recusa do
  // servidor. A tentativa é lida aqui, no passo e no aviso de agora, e não numa
  // constante à parte: ela muda fora do React (`closeRecordedAttempt`).
  const outdated =
    step === 'confirm' && !pending && reward && availability
      ? redeem.attemptRecorded(reward)
        ? 'alreadyRedeemed'
        : availability.state === 'soldOut'
          ? 'soldOut'
          : availability.state === 'limitReached'
            ? 'limitReached'
            : availability.state === 'short'
              ? 'insufficientPoints'
              : confirmedCost !== null && reward.cost !== confirmedCost
                ? 'changed'
                : null
      : null;
  if (outdated) {
    setFailure(outdated);
    setStep('details');
  } else if (
    step === 'details' &&
    failure === null &&
    !pending &&
    reward &&
    redeem.attemptRecorded(reward)
  ) {
    // A sheet reaberta depois da falha: o detalhe já diz que o pedido foi
    // registrado, e um toque em "Resgatar" é um resgate novo, com ele à vista.
    setFailure('alreadyRedeemed');
  }

  // No frame seguinte ao render: no Android, o comando do foco pode chegar antes
  // de o campo voltar a ficar editável no mesmo lote do commit.
  useEffect(() => {
    if (!whatsappFocus.current || lockedWhatsapp !== null || pending) return;
    const frame = requestAnimationFrame(() => {
      whatsappFocus.current = false;
      whatsappRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  });

  useStayOnScreen(pending);
  useFocusOnChange(
    `${step}:${recoveries}`,
    step === 'details' && refusal !== null ? notice : heading,
  );
  useAnnounceWhen(
    reward === undefined && query.isError && !query.isFetching,
    t('rewards.details.loadError'),
  );
  useAnnounceWhen(reward === null, t('rewards.details.notFound'));

  const goTo = (next: RedeemStep): void => {
    setFailure(null);
    setStep(next);
  };

  const openConfirm = (item: Reward): void => {
    // O pedido da tentativa anterior já está à vista: este é um resgate novo.
    redeem.closeRecordedAttempt(item);
    setConfirmedCost(item.cost);
    goTo('confirm');
  };

  /**
   * O campo recusado: o erro nele, o anúncio (o foco num campo já focado não
   * fala) e o foco, no render seguinte, com o campo já editável.
   */
  const refuseWhatsapp = (kind: WhatsappError): void => {
    setWhatsappError(kind);
    whatsappFocus.current = true;
    announce(t(WHATSAPP_ERRORS[kind]));
  };

  const changeWhatsapp = (text: string): void => {
    setTypedWhatsapp(maskWhatsapp(text));
    setWhatsappError(null);
  };

  const confirm = (item: Reward, cost: number): void => {
    const whatsapp = lockedWhatsapp ?? parseWhatsapp(whatsappValue);
    if (whatsapp === null) {
      refuseWhatsapp(whatsappValue.trim() === '' ? 'required' : 'invalid');
      return;
    }
    setFailure(null);
    setWhatsappError(null);
    redeem.redeem(cost, whatsapp, {
      onSuccess: () => {
        setRedeemed(item);
        setStep('success');
      },
      onError: (error) => {
        const kind = redeemFailure(error);
        // O servidor recusou o número: a confirmação continua, com o erro no campo.
        if (kind === 'whatsappInvalid') {
          setFailure(null);
          refuseWhatsapp('invalid');
          return;
        }
        setFailure(kind);
        // Recusa definitiva volta ao detalhe, que já mostra o saldo ou o estoque novo.
        if (kind !== 'failed') {
          setStep('details');
          return;
        }
        // Continua na confirmação, com o foco no botão: o anúncio não é cortado.
        announce(t('rewards.errors.failed'));
      },
    });
  };

  const retry = (): void => {
    setRetrying(true);
    void query
      .refetch()
      .then((result) => {
        // A recompensa chegou: o foco vai para o título dela.
        if (result.data) setRecoveries((count) => count + 1);
      })
      .finally(() => setRetrying(false));
  };

  let body: ReactNode = null;
  let actions: ReactNode = null;

  if (step === 'success' && redeemed && redeem.data) {
    body = (
      <SuccessBody
        reward={redeemed}
        result={redeem.data}
        whatsapp={redeem.variables?.whatsapp ?? null}
        headingRef={heading}
      />
    );
    actions = <SuccessActions onDone={closeSheet} />;
  } else if (reward && availability) {
    if (step === 'confirm') {
      const cost = confirmedCost ?? reward.cost;
      body = (
        <ConfirmBody
          reward={reward}
          cost={cost}
          balance={balance}
          headingRef={heading}
          whatsapp={{
            value: whatsappValue,
            onChange: changeWhatsapp,
            error: shownWhatsappError ? t(WHATSAPP_ERRORS[shownWhatsappError]) : undefined,
            locked: lockedWhatsapp !== null,
            pending,
            inputRef: whatsappRef,
          }}
        />
      );
      actions = (
        <ConfirmActions
          online={online}
          pending={pending}
          failed={failure === 'failed'}
          onConfirm={() => confirm(reward, cost)}
          onBack={() => goTo('details')}
        />
      );
    } else {
      body = (
        <DetailsBody
          reward={reward}
          availability={availability}
          balance={balance}
          headingRef={heading}
        />
      );
      actions = (
        <DetailsActions
          reward={reward}
          availability={availability}
          online={online}
          notice={refusal}
          noticeRef={notice}
          onRedeem={() => openConfirm(reward)}
          onSeeMissions={goToMissions}
        />
      );
    }
  } else if (reward === null) {
    body = <EmptyState message={t('rewards.details.notFound')} />;
  } else if (query.isError || retrying) {
    body = (
      <EmptyState
        tone="error"
        message={t('rewards.details.loadError')}
        onAction={retry}
        actionLoading={retrying}
      />
    );
  } else {
    body = <DetailsSkeleton />;
  }

  return (
    <View style={styles.root}>
      {standalone ? null : <SheetGrabber />}
      <View
        style={[
          styles.header,
          standalone && { paddingTop: insets.top + spacing.xs },
          walletFailed && styles.headerEnd,
        ]}
      >
        {/* Sem o saldo (a carteira falhou), a pílula sai: ela diria "carregando" para sempre. */}
        {walletFailed ? null : <PointsPill value={balance} />}
        <BackButton variant="close" onPress={closeSheet} disabled={pending} />
      </View>
      {/* O campo do WhatsApp da confirmação: o toque fora do teclado não se perde,
          e o iOS sobe o conteúdo acima do teclado (o Android redimensiona a sheet). */}
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={isIOS}
      >
        <Animated.View key={step} entering={FadeIn.duration(motion.duration.base)}>
          {body}
        </Animated.View>
      </ScrollView>
      {actions ? (
        <Animated.View
          key={step}
          entering={FadeIn.duration(motion.duration.base)}
          style={[styles.actions, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}
        >
          {actions}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  fill: {
    flex: 1,
  },
  // Abaixo do puxador da sheet. O "×" fica colado ao fim do alvo, na mesma
  // coluna do conteúdo.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
  },
  headerEnd: {
    justifyContent: 'flex-end',
  },
  body: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  actions: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.gutter,
  },
});
