import { Check, CircleAlert, Info, WifiOff, type LucideIcon } from 'lucide-react-native';
import type { Ref, RefObject } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { SectionLabel } from '@/components/section-label';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { t } from '@/i18n';
import { colors, layout, radii, spacing, typography } from '@/theme';
import { formatNumber, formatPointsSpoken } from '@/utils/number';

import {
  isOpenRedemption,
  limitReachedText,
  missingSpoken,
  redemptionStatusSpoken,
  redemptionStatusText,
  rewardMeta,
  rewardMetaSpoken,
  scarcityText,
  type RedeemFailure,
  type RewardAvailability,
} from '../describe-reward';
import type { RedeemResult, Reward, RewardRedemption } from '../types';
import { REWARD_PHOTO_ASPECT, RewardMedia } from './reward-media';
import { RewardSummary, type SummaryLine } from './reward-summary';

/** Os três passos da sheet de resgate. */
export type RedeemStep = 'details' | 'confirm' | 'success';

type HeadingRef = RefObject<View | null>;

const NOTICE_ICON_SIZE = 16;
// Marca do resgate confirmado: círculo lima com o check em tinta.
const SUCCESS_MARK_SIZE = 56;
const SUCCESS_CHECK_SIZE = 28;
const SUCCESS_CHECK_STROKE = 2.6;

const noop = (): void => undefined;

/**
 * Título do passo. É o alvo do foco do leitor de tela quando o passo troca
 * (`useFocusOnChange`), por isso um `View` com a ref, e não o texto. `label`
 * junta ao título o que o foco precisa dizer (o saldo novo no sucesso).
 */
function StepHeading({
  text,
  label = text,
  headingRef,
}: {
  text: string;
  label?: string;
  headingRef: HeadingRef;
}) {
  return (
    <View ref={headingRef} accessible accessibilityRole="header" accessibilityLabel={label}>
      <Text variant="titleCard">{text}</Text>
    </View>
  );
}

/**
 * Aviso de uma linha (resposta do servidor, falta de internet), lido como um
 * texto só. Fica no pé, junto do botão: com a fonte grande, no fim do corpo
 * ele caía abaixo da dobra.
 */
function Notice({
  text,
  icon = Info,
  iconColor = colors.textMuted,
  ref,
  style,
}: {
  text: string;
  icon?: LucideIcon;
  iconColor?: string;
  ref?: Ref<View>;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View ref={ref} accessible accessibilityLabel={text} style={[styles.notice, style]}>
      <Icon icon={icon} size={NOTICE_ICON_SIZE} color={iconColor} />
      <Text variant="bodySmall" color={colors.textSecondary} style={styles.noticeText}>
        {text}
      </Text>
    </View>
  );
}

function OfflineNotice() {
  return <Notice text={t('rewards.details.offline')} icon={WifiOff} style={styles.below} />;
}

/**
 * O texto de baixo do pedido: as instruções no solicitado e no aprovado; no
 * recusado, o motivo da equipe (quando há) e os pontos que voltaram de fato
 * (só com `refundedPoints` maior que 0); no entregue, nada.
 */
function redemptionDetails(redemption: RewardRedemption): string[] {
  if (isOpenRedemption(redemption)) return [redemption.instructions];
  if (redemption.status !== 'refused') return [];
  const lines: string[] = [];
  if (redemption.refusalReason) {
    lines.push(t('rewards.redeemed.reason', { reason: redemption.refusalReason }));
  }
  if (redemption.refundedPoints > 0) {
    lines.push(t('rewards.redeemed.refunded', { points: formatNumber(redemption.refundedPoints) }));
  }
  return lines;
}

/**
 * Um pedido que o fã já fez (bloco 10, sem desenho, no visual das outras
 * telas): o código para mostrar na retirada, o status com a data dele e o que
 * fazer, ou por que foi recusado. O código com o status é um foco só; o texto
 * de baixo, outro.
 */
function RedemptionCard({ redemption }: { redemption: RewardRedemption }) {
  const details = redemptionDetails(redemption);
  return (
    <Card>
      <View
        accessible
        accessibilityLabel={t('rewards.redeemed.codeLabel', {
          code: redemption.code,
          status: redemptionStatusSpoken(redemption),
        })}
      >
        <Text variant="overline" color={colors.textMuted}>
          {t('rewards.success.code')}
        </Text>
        <Text variant="titleEvent" selectable style={styles.code}>
          {redemption.code}
        </Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.meta}>
          {redemptionStatusText(redemption)}
        </Text>
      </View>
      {details.length > 0 ? (
        <Text variant="bodySmall" color={colors.textBody} style={styles.instructions}>
          {details.join('\n')}
        </Text>
      ) : null}
    </Card>
  );
}

export interface DetailsBodyProps {
  reward: Reward;
  availability: RewardAvailability;
  balance: number | null;
  headingRef: HeadingRef;
}

/**
 * O detalhe: foto ou ícone, selo de escassez, título, show ou subtítulo, os
 * resgates que o fã já fez (código e instruções de novo), a descrição do
 * painel e o quadro com o custo e o saldo depois (ou o saldo de agora, quando
 * ele não cobre).
 */
export function DetailsBody({ reward, availability, balance, headingRef }: DetailsBodyProps) {
  const outOfReach =
    availability.state === 'short' ||
    availability.state === 'soldOut' ||
    availability.state === 'limitReached';
  const scarcity = scarcityText(reward);
  const lines: SummaryLine[] = [
    { label: t('rewards.summary.cost'), points: reward.cost, highlight: true },
  ];
  if (balance !== null && availability.state === 'redeemable') {
    lines.push({ label: t('rewards.summary.balanceAfter'), points: balance - reward.cost });
  } else if (balance !== null && availability.state === 'short') {
    lines.push({ label: t('rewards.summary.balance'), points: balance });
  }

  return (
    <View>
      <RewardMedia reward={reward} outOfReach={outOfReach} />
      <View style={styles.titleBlock}>
        {availability.state === 'soldOut' ? (
          <Pill label={t('rewards.soldOut')} tone="neutral" size="xs" caps style={styles.badge} />
        ) : scarcity ? (
          <Pill label={scarcity} tone="accentStrong" size="xs" caps style={styles.badge} />
        ) : null}
        <StepHeading text={reward.title} headingRef={headingRef} />
        <Text
          variant="caption"
          color={colors.textSecondary}
          accessibilityLabel={rewardMetaSpoken(reward)}
          style={styles.meta}
        >
          {rewardMeta(reward)}
        </Text>
      </View>
      {reward.redemptions.length > 0 ? (
        <>
          <SectionLabel spacing="tight">{t('rewards.redeemed.title')}</SectionLabel>
          <View style={styles.redemptions}>
            {reward.redemptions.map((redemption) => (
              <RedemptionCard key={redemption.id} redemption={redemption} />
            ))}
          </View>
        </>
      ) : null}
      {reward.description ? (
        <Text variant="body" color={colors.textBody} style={styles.paragraph}>
          {reward.description}
        </Text>
      ) : null}
      <RewardSummary lines={lines} style={styles.block} />
    </View>
  );
}

export interface DetailsActionsProps {
  reward: Reward;
  availability: RewardAvailability;
  online: boolean;
  /** Por que o último resgate foi recusado, se foi: aviso em cima do botão. */
  notice: Exclude<RedeemFailure, 'failed'> | null;
  /** O aviso recebe o foco do leitor de tela quando a recusa traz o fã de volta ao detalhe. */
  noticeRef: HeadingRef;
  onRedeem: () => void;
  onSeeMissions: () => void;
}

/**
 * O botão lima do resgate (o assunto é ponto), que leva à confirmação. Sem
 * saldo, desligado com o que falta e "Ver missões"; esgotado, desligado; no
 * limite de pedidos do fã, desligado com "Você já resgatou" (ou "Limite de N
 * resgates atingido"); sem internet, desligado com o aviso. A recusa do
 * servidor vem em cima do botão.
 */
export function DetailsActions({ notice, noticeRef, ...buttons }: DetailsActionsProps) {
  return (
    <>
      {notice ? (
        <Notice ref={noticeRef} text={t(`rewards.errors.${notice}`)} style={styles.above} />
      ) : null}
      <DetailsButtons {...buttons} />
    </>
  );
}

function DetailsButtons({
  reward,
  availability,
  online,
  onRedeem,
  onSeeMissions,
}: Omit<DetailsActionsProps, 'notice' | 'noticeRef'>) {
  switch (availability.state) {
    case 'soldOut':
      return <Button variant="points" label={t('rewards.soldOut')} disabled onPress={noop} />;
    case 'limitReached':
      return <Button variant="points" label={limitReachedText(reward)} disabled onPress={noop} />;
    case 'short':
      return (
        <>
          <Button
            variant="points"
            label={missingSpoken(availability.missing)}
            disabled
            onPress={noop}
          />
          <TextLink
            label={t('rewards.details.seeMissions')}
            accessibilityHint={t('rewards.details.seeMissionsHint')}
            onPress={onSeeMissions}
            style={styles.link}
          />
        </>
      );
    default:
      return (
        <>
          <Button
            variant="points"
            label={t('rewards.details.redeem', { points: formatNumber(reward.cost) })}
            accessibilityLabel={t('rewards.details.redeemLabel', {
              points: formatPointsSpoken(reward.cost),
            })}
            accessibilityHint={t('rewards.details.redeemHint')}
            disabled={!online}
            onPress={onRedeem}
          />
          {online ? null : <OfflineNotice />}
        </>
      );
  }
}

export interface ConfirmBodyProps {
  reward: Reward;
  /**
   * O custo congelado ao entrar na confirmação (`confirmedCost`), e não o da
   * recompensa ao vivo, que uma busca de fundo troca em silêncio: é o que o
   * botão manda ao servidor (25.12).
   */
  cost: number;
  balance: number | null;
  headingRef: HeadingRef;
}

/**
 * A confirmação: quanto sai do saldo, como ele fica e que a entrega é com a
 * equipe. O "depois" só aparece quando o saldo cobre (se ele deixar de cobrir,
 * a tela volta ao detalhe).
 */
export function ConfirmBody({
  reward,
  cost: confirmedCost,
  balance,
  headingRef,
}: ConfirmBodyProps) {
  const cost: SummaryLine = {
    label: t('rewards.summary.cost'),
    points: confirmedCost,
    highlight: true,
  };
  const lines: SummaryLine[] =
    balance === null
      ? [cost]
      : balance >= confirmedCost
        ? [
            { label: t('rewards.summary.balanceNow'), points: balance },
            cost,
            { label: t('rewards.summary.balanceAfter'), points: balance - confirmedCost },
          ]
        : [{ label: t('rewards.summary.balanceNow'), points: balance }, cost];

  return (
    <View>
      <StepHeading text={t('rewards.confirm.title')} headingRef={headingRef} />
      <Text variant="body" color={colors.textSecondary} style={styles.lead}>
        {t('rewards.confirm.body', {
          points: formatPointsSpoken(confirmedCost),
          title: reward.title,
        })}
      </Text>
      <RewardSummary lines={lines} style={styles.block} />
      <Text variant="bodyXs" color={colors.textTertiary} style={styles.paragraph}>
        {t('rewards.confirm.note')}
      </Text>
    </View>
  );
}

export interface ConfirmActionsProps {
  online: boolean;
  pending: boolean;
  /** O último envio falhou sem resposta clara (rede, servidor): dá para tentar de novo. */
  failed: boolean;
  onConfirm: () => void;
  onBack: () => void;
}

/**
 * "Confirmar resgate" sem toque próprio: quem vibra é a resposta (`redeem` no
 * sucesso, `insufficientPoints` sem saldo). Enquanto vai, "Voltar" fica preso.
 * A falha sem resposta clara vem em cima do botão, que continua com o foco.
 */
export function ConfirmActions({
  online,
  pending,
  failed,
  onConfirm,
  onBack,
}: ConfirmActionsProps) {
  return (
    <>
      {failed ? (
        <Notice
          text={t('rewards.errors.failed')}
          icon={CircleAlert}
          iconColor={colors.danger}
          style={styles.above}
        />
      ) : null}
      <Button
        variant="points"
        label={t('rewards.confirm.action')}
        loading={pending}
        disabled={!online}
        haptic={null}
        onPress={onConfirm}
      />
      {online ? null : <OfflineNotice />}
      <Button
        variant="ghost"
        size="md"
        label={t('rewards.confirm.back')}
        disabled={pending}
        onPress={onBack}
        style={styles.secondary}
      />
    </>
  );
}

export interface SuccessBodyProps {
  reward: Reward;
  result: RedeemResult;
  headingRef: HeadingRef;
}

/**
 * Resgate confirmado: o código para mostrar na retirada, com o status do
 * pedido (o "Solicitado em" do card de "Seus resgates", um foco só), e as
 * instruções do servidor. O título leva o saldo novo para o leitor de tela,
 * que chega nele pelo foco (um anúncio à parte seria cortado por esse foco).
 */
export function SuccessBody({ reward, result, headingRef }: SuccessBodyProps) {
  // O pedido nasce solicitado, no instante do resgate (25.2).
  const status: Pick<RewardRedemption, 'status' | 'statusAt'> = {
    status: result.status ?? 'requested',
    statusAt: result.redeemedAt,
  };
  return (
    <View>
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={styles.successMark}
      >
        <Icon
          icon={Check}
          size={SUCCESS_CHECK_SIZE}
          color={colors.onPoints}
          strokeWidth={SUCCESS_CHECK_STROKE}
        />
      </View>
      <StepHeading
        text={t('rewards.success.title')}
        label={t('rewards.success.announcement', {
          balance: formatPointsSpoken(result.balance),
        })}
        headingRef={headingRef}
      />
      <Text variant="body" color={colors.textSecondary} style={styles.meta}>
        {reward.title}
      </Text>
      <Card
        accessible
        accessibilityLabel={t('rewards.redeemed.codeLabel', {
          code: result.code,
          status: redemptionStatusSpoken(status),
        })}
        style={styles.block}
      >
        <Text variant="overline" color={colors.textMuted}>
          {t('rewards.success.code')}
        </Text>
        <Text variant="titleEvent" selectable style={styles.code}>
          {result.code}
        </Text>
        <Text variant="caption" color={colors.textSecondary} style={styles.meta}>
          {redemptionStatusText(status)}
        </Text>
      </Card>
      <SectionLabel spacing="tight">{t('rewards.success.nextSteps')}</SectionLabel>
      <Text variant="body" color={colors.textBody}>
        {result.instructions}
      </Text>
      <Text variant="bodyXs" color={colors.textTertiary} style={styles.paragraph}>
        {t('rewards.success.tracking')}
      </Text>
    </View>
  );
}

export function SuccessActions({ onDone }: { onDone: () => void }) {
  return <Button label={t('rewards.success.done')} onPress={onDone} />;
}

/** O detalhe carregando, nas medidas dele: foto, título, show, descrição e o quadro. */
export function DetailsSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('rewards.details.loading')}>
      <Skeleton tone="sunken" height="auto" radius={radii.xl} style={styles.media} />
      <Skeleton
        tone="line"
        width="70%"
        height={typography.titleCard.lineHeight}
        style={styles.titleBlock}
      />
      <Skeleton
        tone="line"
        width="45%"
        height={typography.caption.lineHeight}
        style={styles.meta}
      />
      <Skeleton tone="line" height={typography.body.lineHeight * 2} style={styles.paragraph} />
      <Skeleton
        tone="surface"
        height={layout.buttonHeight.lg * 2}
        radius={radii.lg}
        style={styles.block}
      />
    </SkeletonGroup>
  );
}

// Vãos do detalhe, no ritmo das outras telas: foto até o título 16, selo a 10
// do título, título até a linha do show 6, blocos a 18 um do outro.
const styles = StyleSheet.create({
  titleBlock: {
    marginTop: spacing.lg,
  },
  badge: {
    alignSelf: 'flex-start',
    marginBottom: spacing.listGap,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  lead: {
    marginTop: spacing.sm,
  },
  paragraph: {
    marginTop: spacing.blockGap,
  },
  block: {
    marginTop: spacing.blockGap,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  // No pé: a resposta do servidor em cima do botão, a falta de internet embaixo.
  above: {
    marginBottom: spacing.sm,
  },
  below: {
    marginTop: spacing.lg,
  },
  redemptions: {
    gap: spacing.listGap,
  },
  instructions: {
    marginTop: spacing.md,
  },
  noticeText: {
    flex: 1,
  },
  link: {
    alignSelf: 'center',
  },
  secondary: {
    marginTop: spacing.xs,
  },
  successMark: {
    width: SUCCESS_MARK_SIZE,
    height: SUCCESS_MARK_SIZE,
    borderRadius: SUCCESS_MARK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.points,
    marginBottom: spacing.lg,
  },
  code: {
    marginTop: spacing.metaGap,
  },
  media: {
    alignSelf: 'stretch',
    aspectRatio: REWARD_PHOTO_ASPECT,
  },
});
