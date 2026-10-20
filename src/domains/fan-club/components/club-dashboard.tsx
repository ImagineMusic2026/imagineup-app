import { router } from 'expo-router';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Pill } from '@/components/pill';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { TERMS_URL } from '@/config/links';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { openWebPage } from '@/services/web-page';
import { colors, spacing } from '@/theme';

import { FAN_CLUB_PENDING_MAX } from '../consts';
import { fanClubErrorText, UNAVAILABLE_TEXTS } from '../describe';
import type { NextRound } from '../entry';
import { formatDayKey, nextRoundText } from '../format';
import {
  useAcceptFanClubRulesMutation,
  useMyFanClubNumbersQuery,
  useShareFanClub,
} from '../queries';
import { fanClubHref } from '../share';
import type { FanClubStatus, MyFanClub, MyFanClubClub } from '../types';
import { ApplyAgain } from './application-state';
import { ContactCard } from './contact-card';
import { FanClubNotice } from './fan-club-notice';
import { NumberGrid } from './number-card';
import { OwnPosts } from './own-posts';
import { PrizesCard } from './prizes-card';
import { TeamEmailLink } from './team-email-link';

const STATUS_TEXTS: Record<FanClubStatus, TranslationKey> = {
  active: 'fanClub.mine.status.active',
  paused: 'fanClub.mine.status.paused',
  closed: 'fanClub.mine.status.closed',
};

/**
 * O cabeçalho: o nome, o artista e o status, num foco só. A faixa não oficial
 * fica nas telas públicas, e não nas do gestor (pedido do dono de 20/10/2026,
 * 34.22).
 */
function ClubHeader({ club }: { club: MyFanClubClub }) {
  const status = t(STATUS_TEXTS[club.status]);
  return (
    <Card
      variant="large"
      accessible
      accessibilityRole="header"
      accessibilityLabel={t('fanClub.mine.headerLabel', {
        name: club.name,
        artist: club.artistName,
        status,
      })}
      style={styles.header}
      testID="fan-club-header"
    >
      <Text variant="titleCard">{club.name}</Text>
      <Text variant="body" color={colors.textSecondary}>
        {club.artistName}
      </Text>
      <Pill label={status} size="xs" style={styles.status} />
    </Card>
  );
}

/**
 * "O regulamento mudou" (o `rulesOutdated`): o link do regulamento (ou dos
 * Termos de Uso, sem ele) e "Aceitar" (`PUT /me/fan-club/rules`). O publicar
 * espera o aceite.
 */
function RulesNotice({ mine }: { mine: MyFanClub }) {
  const online = useIsOnline();
  const accept = useAcceptFanClubRulesMutation();
  const [failure, setFailure] = useState<TranslationKey | null>(null);
  const url = mine.rulesUrl ?? TERMS_URL;

  const run = () => {
    setFailure(null);
    accept.mutate(mine.rulesVersion, {
      onSuccess: () => {
        haptics.trigger('success');
        AccessibilityInfo.announceForAccessibility(t('fanClub.mine.rules.accepted'));
      },
      onError: (error) => {
        const key = fanClubErrorText(error)?.key ?? actionRefusal(error, 'clubRules').key;
        setFailure(key);
        haptics.trigger('error');
        AccessibilityInfo.announceForAccessibility(t(key));
      },
    });
  };

  return (
    <FanClubNotice
      tone="warning"
      title={t('fanClub.mine.rules.title')}
      body={t('fanClub.mine.rules.body')}
      testID="fan-club-rules-notice"
    >
      <TextLink
        label={t(
          mine.rulesUrl ? 'fanClub.mine.rules.readRegulation' : 'fanClub.mine.rules.readTerms',
        )}
        role="link"
        onPress={() => openWebPage(url)}
        testID="fan-club-rules-read"
      />
      {failure ? (
        <Text variant="caption" color={colors.danger}>
          {t(failure)}
        </Text>
      ) : null}
      {/* Numa fileira, como o "Ver meus prêmios": o aviso alinha as ações ao
          começo, e o Button direto nele esticaria sem fim na rolagem. */}
      <View style={styles.acceptRow} testID="fan-club-rules-accept-row">
        <Button
          label={t('fanClub.mine.rules.accept')}
          size="md"
          onPress={run}
          loading={accept.isPending}
          disabled={!online || accept.isPending}
          style={styles.accept}
          testID="fan-club-rules-accept"
        />
      </View>
    </FanClubNotice>
  );
}

export interface ClubDashboardProps {
  mine: MyFanClub;
  club: MyFanClubClub;
  /** Só no encerrado: quando vem a próxima candidatura. */
  next: NextRound | null;
}

/**
 * O "Meu fã-clube" do gestor (34.9, item 5): o aviso de fora do ar (o
 * `unavailableReason`) e o do regulamento novo, o cabeçalho, os seguidores, o
 * Destaque, o card Prêmios, o compartilhar, os números, a nova publicação,
 * "Minhas publicações", o WhatsApp para a equipe e o pedido de encerramento.
 * Fora do ar, sem Compartilhar e sem Nova publicação. O encerrado continua
 * aqui, com os números (o servidor os dá em qualquer status, 34.22, etapa 3),
 * o aviso de que acabou e a próxima rodada no aviso, sem o pedido de
 * encerramento. Os números vêm do `GET /me/fan-club/numbers`; as publicações
 * no ar e em análise, do estado do fã. "Ver como os fãs veem" abre a página
 * pública (etapa 8), só com o fã-clube no ar.
 */
export function ClubDashboard({ mine, club, next }: ClubDashboardProps) {
  const numbers = useMyFanClubNumbersQuery(true);
  const share = useShareFanClub();
  const value = (field: keyof NonNullable<typeof numbers.data>) =>
    numbers.data ? numbers.data[field] : null;
  // A leitura dos números falhou: os cartões dizem "Sem dado", e não carregando.
  const failed = numbers.isError && !numbers.data;
  const closed = club.status === 'closed';
  const full = club.pendingPosts >= FAN_CLUB_PENDING_MAX;
  const canPost = club.available && !club.rulesOutdated && !full;

  return (
    <View testID="fan-club-dashboard">
      {!club.available && club.unavailableReason ? (
        <FanClubNotice
          tone="warning"
          body={t(UNAVAILABLE_TEXTS[club.unavailableReason])}
          style={styles.notice}
          testID="fan-club-unavailable"
        >
          {next ? (
            <>
              <Text variant="body" testID="fan-club-next-round">
                {nextRoundText(next)}
              </Text>
              <ApplyAgain next={next} inline />
            </>
          ) : null}
        </FanClubNotice>
      ) : null}
      {club.rulesOutdated && !closed ? (
        <View style={styles.notice}>
          <RulesNotice mine={mine} />
        </View>
      ) : null}
      <ClubHeader club={club} />
      <View style={styles.block}>
        <NumberGrid
          items={[
            { label: t('fanClub.mine.followers'), value: value('followers'), failed },
            { label: t('fanClub.mine.followers30d'), value: value('followers30d'), failed },
          ]}
          testID="fan-club-followers"
        />
      </View>
      {club.featuredUntil ? (
        <Pill
          label={t('fanClub.mine.featured', { date: formatDayKey(club.featuredUntil) })}
          size="sm"
          style={styles.featured}
          testID="fan-club-featured"
        />
      ) : null}
      {numbers.isError ? (
        <View style={styles.numbersError}>
          <Text variant="caption" color={colors.textSecondary}>
            {t('fanClub.mine.numbersError')}
          </Text>
          <TextLink
            label={t('common.retry')}
            onPress={() => void numbers.refetch()}
            testID="fan-club-numbers-retry"
          />
        </View>
      ) : null}
      <View style={styles.block}>
        <PrizesCard lastReward={club.lastReward} />
      </View>
      {club.available ? (
        <>
          <Button
            label={t('fanClub.mine.share')}
            variant="secondary"
            onPress={() => share(club)}
            accessibilityHint={t('fanClub.mine.shareHint')}
            style={styles.block}
            testID="fan-club-share"
          />
          <TextLink
            label={t('fanClub.mine.preview')}
            onPress={() => router.push(fanClubHref(club.id))}
            accessibilityHint={t('fanClub.mine.previewHint')}
            style={styles.preview}
            testID="fan-club-preview"
          />
        </>
      ) : null}
      <SectionLabel>{t('fanClub.mine.numbersTitle')}</SectionLabel>
      <NumberGrid
        items={[
          { label: t('fanClub.mine.links'), value: value('links'), failed },
          { label: t('fanClub.mine.visits'), value: value('visits'), failed },
          { label: t('fanClub.mine.signups'), value: value('signups'), failed },
          { label: t('fanClub.mine.joins'), value: value('joins'), failed },
          { label: t('fanClub.mine.published'), value: club.postCount },
          { label: t('fanClub.mine.pendingPosts'), value: club.pendingPosts },
        ]}
        testID="fan-club-numbers"
      />
      {club.available ? (
        <View style={styles.block}>
          {full ? (
            <Text variant="caption" color={colors.textSecondary} style={styles.postNote}>
              {t('fanClub.errors.refused.tooManyPending')}
            </Text>
          ) : null}
          <Button
            label={t('fanClub.mine.newPost')}
            onPress={() => router.push('/meu-fa-clube/nova-publicacao')}
            disabled={!canPost}
            accessibilityHint={t('fanClub.mine.newPostHint')}
            testID="fan-club-new-post"
          />
        </View>
      ) : null}
      <OwnPosts />
      <SectionLabel>{t('fanClub.mine.contact.title')}</SectionLabel>
      <ContactCard />
      {closed ? null : (
        <View style={styles.close}>
          <TeamEmailLink
            label="fanClub.mine.close"
            hint="fanClub.mine.closeHint"
            subject="fanClub.mine.closeSubject"
            testID="fan-club-close"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  acceptRow: {
    flexDirection: 'row',
  },
  // Com a fonte grande, o rótulo quebra dentro da largura do aviso.
  accept: {
    flexShrink: 1,
  },
  block: {
    marginTop: spacing.lg,
  },
  notice: {
    marginBottom: spacing.lg,
  },
  header: {
    gap: spacing.sm,
  },
  status: {
    alignSelf: 'flex-start',
  },
  featured: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
  preview: {
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  numbersError: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
  postNote: {
    marginBottom: spacing.sm,
  },
  close: {
    marginTop: spacing.sectionTop,
  },
});
