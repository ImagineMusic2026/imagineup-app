import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, Alert, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Text } from '@/components/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';
import { formatDate } from '@/utils/date';

import { REJECT_REASON_TEXTS } from '../describe';
import type { NextRound } from '../entry';
import { nextRoundText } from '../format';
import { useWithdrawApplicationMutation } from '../queries';
import type { FanClubApplication } from '../types';
import { UnofficialBand } from './unofficial-band';

/** O nome proposto e o artista da candidatura, numa linha. */
function Summary({ application }: { application: FanClubApplication }) {
  return (
    <Text variant="label" style={styles.summary}>
      {t('fanClub.state.summary', {
        name: application.proposedName,
        artist: application.artistName,
      })}
    </Text>
  );
}

/**
 * "Enviar nova candidatura", só quando a vez do fã já chegou. Com `inline`
 * (dentro do aviso do "Meu fã-clube", que alinha as ações ao começo), o botão
 * vai numa fileira, como o "Aceitar" e o "Ver meus prêmios": direto na coluna,
 * o desenho do Button esticaria sem fim na rolagem (etapa 10 de 34.14).
 */
export function ApplyAgain({ next, inline = false }: { next: NextRound; inline?: boolean }) {
  if (next.kind !== 'now') return null;
  const button = (
    <Button
      label={t('fanClub.state.applyAgain')}
      onPress={() => router.push('/meu-fa-clube/candidatura')}
      accessibilityHint={t('fanClub.intro.applyHint')}
      style={inline ? [styles.action, styles.shrink] : styles.action}
      testID="fan-club-apply-again"
    />
  );
  if (!inline) return button;
  return (
    <View style={styles.row} testID="fan-club-apply-again-row">
      {button}
    </View>
  );
}

/**
 * Em análise (34.9, item 4): "Em análise desde {{date}}" e "Desistir da
 * candidatura", com a confirmação. Desistir é livre para o suspenso e não
 * tem teto; a falha fica embaixo do botão, anunciada. O resultado da equipe
 * aparece quando o fã abre a tela de novo (não há notificação, 3.1.i).
 */
export function PendingState({ application }: { application: FanClubApplication }) {
  const online = useIsOnline();
  const withdraw = useWithdrawApplicationMutation();
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  useStayOnScreen(withdraw.isPending);

  const run = () => {
    setFailure(null);
    withdraw.mutate(undefined, {
      // Sem a pendente (a equipe decidiu antes), o servidor devolve o estado de
      // agora sem gravar: só a desistência que valeu é anunciada; a tela troca.
      onSuccess: (mine) => {
        if (mine.application?.status !== 'withdrawn') return;
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(t('fanClub.state.withdrawn'));
      },
      onError: (error) => {
        const key = actionRefusal(error, 'clubWithdraw').key;
        setFailure(key);
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t(key));
      },
    });
  };

  const confirm = () =>
    Alert.alert(t('fanClub.state.withdrawTitle'), t('fanClub.state.withdrawBody'), [
      { text: t('fanClub.state.withdrawCancel'), style: 'cancel' },
      { text: t('fanClub.state.withdrawConfirm'), style: 'destructive', onPress: run },
    ]);

  return (
    <View testID="fan-club-pending">
      <UnofficialBand />
      <Card variant="large" style={styles.card}>
        <Text variant="titleCard" accessibilityRole="header">
          {t('fanClub.state.pendingTitle')}
        </Text>
        <Summary application={application} />
        {application.submittedAt ? (
          <Text variant="body" color={colors.textSecondary}>
            {t('fanClub.state.pendingSince', { date: formatDate(application.submittedAt) })}
          </Text>
        ) : null}
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.state.pendingBody')}
        </Text>
      </Card>
      {failure ? (
        <Text variant="caption" color={colors.danger} style={styles.error}>
          {t(failure)}
        </Text>
      ) : null}
      <Button
        label={t('fanClub.state.withdraw')}
        variant="secondary"
        onPress={confirm}
        loading={withdraw.isPending}
        disabled={!online || withdraw.isPending}
        accessibilityHint={t('fanClub.state.withdrawHint')}
        style={styles.action}
        testID="fan-club-withdraw"
      />
    </View>
  );
}

/**
 * A candidatura recusada (34.9, item 4): o motivo em texto fixo por código e
 * quando dá para mandar de novo (a data, a frase do fim da 3ª rodada ou, com a
 * vez do fã, o botão da nova candidatura).
 */
export function RejectedState({
  application,
  next,
}: {
  application: FanClubApplication;
  next: NextRound;
}) {
  return (
    <View testID="fan-club-rejected">
      <UnofficialBand />
      <Card variant="large" style={styles.card}>
        <Text variant="titleCard" accessibilityRole="header">
          {t('fanClub.state.rejectedTitle')}
        </Text>
        <Summary application={application} />
        <Text variant="body" color={colors.textSecondary} testID="fan-club-reject-reason">
          {t(REJECT_REASON_TEXTS[application.rejectReason ?? 'other'])}
        </Text>
        <Text variant="body" testID="fan-club-next-round">
          {nextRoundText(next)}
        </Text>
      </Card>
      <ApplyAgain next={next} />
    </View>
  );
}

/**
 * Sem fã-clube para mostrar e sem a vez do fã de mandar outra candidatura: a
 * frase da próxima rodada, e o botão só quando ela chega. O fã-clube
 * encerrado fica no "Meu fã-clube", com o aviso (o `ClubDashboard`).
 */
export function EndedState({ next }: { next: NextRound }) {
  return (
    <View testID="fan-club-ended">
      <UnofficialBand />
      <Card variant="large" style={styles.card}>
        <Text variant="titleCard" accessibilityRole="header">
          {t('fanClub.state.endedTitle')}
        </Text>
        <Text variant="body" testID="fan-club-next-round">
          {nextRoundText(next)}
        </Text>
      </Card>
      <ApplyAgain next={next} />
    </View>
  );
}

/** O programa fechado (`FAN_CLUB_OPEN` desligado) para quem não tem o que mostrar. */
export function ProgramClosedState() {
  return (
    <View testID="fan-club-program-closed">
      <UnofficialBand />
      <Card variant="large" style={styles.card}>
        <Text variant="titleCard" accessibilityRole="header">
          {t('fanClub.state.closedTitle')}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.errors.refused.applicationsClosed')}
        </Text>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  summary: {
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.xl,
  },
  row: {
    flexDirection: 'row',
  },
  // Com a fonte grande, o rótulo quebra dentro da largura do aviso.
  shrink: {
    flexShrink: 1,
  },
  error: {
    marginTop: spacing.lg,
    textAlign: 'center',
  },
});
