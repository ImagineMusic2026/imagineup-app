import { useNavigationContainerRef } from 'expo-router';
import { ChevronRight, FileText, Gift, type LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, useWindowDimensions } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Pill } from '@/components/pill';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { TERMS_URL } from '@/config/links';
import { openArtistOverStack } from '@/domains/posts';
import { useIsOnline } from '@/hooks/use-is-online';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { openWebPage } from '@/services/web-page';
import { colors, isLargeText, radii, spacing, tints, typography } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatNumber } from '@/utils/number';

import { FAN_CLUB_PENDING_MAX } from '../consts';
import { fanClubErrorText, UNAVAILABLE_TEXTS } from '../describe';
import type { NextRound } from '../entry';
import {
  commentsSpoken,
  followersText,
  formatDayKey,
  nextRoundText,
  rateText,
  reactionsSpoken,
} from '../format';
import type { ManagerTab, PostFilter } from '../manager';
import { useAcceptFanClubRulesMutation, useMyFanClubNumbersQuery } from '../queries';
import type { FanClubNumbers, MyFanClub, MyFanClubClub } from '../types';
import { ApplyAgain } from './application-state';
import { FanClubNotice } from './fan-club-notice';
import { lastRewardText } from './prizes-card';
import { TeamEmailLink } from './team-email-link';

const CHEVRON_SIZE = 18;
const NUMBER_SKELETON_WIDTH = 34;
const BIG_SKELETON_WIDTH = 64;

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
          style={styles.shrink}
          testID="fan-club-rules-accept"
        />
      </View>
    </FanClubNotice>
  );
}

/**
 * O fã-clube fora do ar, com o motivo (o `unavailableReason`) e a ação de cada
 * um: no encerrado, a próxima rodada e "Enviar nova candidatura"; fora da
 * central, o caminho de volta para ela; no pausado, "Falar com a equipe". O
 * artista fora do ar e o programa fechado não têm o que o gestor faça.
 */
function UnavailableNotice({ club, next }: { club: MyFanClubClub; next: NextRound | null }) {
  const navigation = useNavigationContainerRef();
  if (club.available || !club.unavailableReason) return null;
  const reason = club.unavailableReason;
  return (
    <FanClubNotice tone="warning" body={t(UNAVAILABLE_TEXTS[reason])} testID="fan-club-unavailable">
      {next ? (
        <>
          <Text variant="body" testID="fan-club-next-round">
            {nextRoundText(next)}
          </Text>
          <ApplyAgain next={next} inline />
        </>
      ) : null}
      {reason === 'not_member' ? (
        <TextLink
          label={t('fanClub.manager.panel.backToCentral', { artist: club.artistName })}
          role="link"
          onPress={() => openArtistOverStack(navigation.getRootState(), club.artistId)}
          accessibilityHint={t('fanClub.page.artistHint')}
          testID="fan-club-back-to-central"
        />
      ) : null}
      {reason === 'paused' ? (
        <TeamEmailLink
          label="fanClub.manager.panel.pausedContact"
          hint="fanClub.manager.panel.pausedContactHint"
          subject="fanClub.manager.panel.pausedSubject"
          testID="fan-club-paused-contact"
        />
      ) : null}
    </FanClubNotice>
  );
}

/** O número de um card: o valor, "Sem dado" na falha, ou o esqueleto enquanto vem. */
function NumberValue({
  value,
  failed,
  big = false,
}: {
  value: number | null;
  failed: boolean;
  big?: boolean;
}) {
  if (value !== null) {
    return (
      <Text variant={big ? 'displayLg' : 'numberDate'} color={colors.points}>
        {formatNumber(value)}
      </Text>
    );
  }
  if (failed) {
    return (
      <Text variant="label" color={colors.textSecondary}>
        {t('fanClub.mine.numberMissing')}
      </Text>
    );
  }
  return (
    <Skeleton
      width={big ? BIG_SKELETON_WIDTH : NUMBER_SKELETON_WIDTH}
      height={big ? typography.displayLg.fontSize : spacing.lg}
      tone="line"
    />
  );
}

/** O valor no rótulo do leitor: o número, ou "Sem dado" na falha. */
function spokenValue(value: number | null, failed: boolean): string | null {
  if (value !== null) return formatNumber(value);
  return failed ? t('fanClub.mine.numberMissing') : null;
}

/**
 * O card grande dos seguidores, no molde do "Pontos gerados pela central" da
 * 4a: o número em lima e o "+N nos últimos 30 dias" (o `followers30d`). Um
 * foco só, sem toque.
 */
function FollowersCard({ numbers, failed }: { numbers?: FanClubNumbers; failed: boolean }) {
  const followers = numbers ? numbers.followers : null;
  const spoken = spokenValue(followers, failed);
  const recent = numbers
    ? t('fanClub.manager.panel.recent', { count: formatNumber(numbers.followers30d) })
    : '';
  return (
    <Card
      variant="large"
      accessible
      accessibilityLabel={
        spoken === null
          ? t('fanClub.manager.panel.followers')
          : numbers
            ? t('fanClub.manager.panel.followersLabel', { value: spoken, recent })
            : t('fanClub.mine.numberLabel', {
                label: t('fanClub.manager.panel.followers'),
                value: spoken,
              })
      }
      style={styles.followers}
      testID="fan-club-followers"
    >
      <Text variant="overline" color={colors.textMuted}>
        {t('fanClub.manager.panel.followers')}
      </Text>
      <NumberValue value={followers} failed={failed} big />
      {numbers ? <Pill label={recent} tone="pointsTint" size="sm" style={styles.recent} /> : null}
    </Card>
  );
}

interface Stat {
  key: keyof Pick<FanClubNumbers, 'links' | 'visits' | 'signups' | 'joins'>;
  label: string;
  note: string;
}

/** Um dos quatro números da divulgação: o valor em lima, o nome e a frase do que ele conta. */
function StatCard({ stat, value, failed }: { stat: Stat; value: number | null; failed: boolean }) {
  const spoken = spokenValue(value, failed);
  return (
    <Card
      variant="compact"
      accessible
      accessibilityLabel={
        spoken === null
          ? stat.label
          : t('fanClub.manager.panel.statLabel', {
              label: stat.label,
              value: spoken,
              note: stat.note,
            })
      }
      style={styles.stat}
      testID={`fan-club-stat-${stat.key}`}
    >
      <NumberValue value={value} failed={failed} />
      <Text variant="labelSmall" color={colors.textSecondary} style={styles.statLabel}>
        {stat.label}
      </Text>
      <Text variant="caption" color={colors.textMuted}>
        {stat.note}
      </Text>
    </Card>
  );
}

/**
 * Os quatro números em duas colunas; da fonte 1,3 em diante (`isLargeText`),
 * um por linha, para a frase não ficar espremida.
 */
function StatGrid({
  club,
  numbers,
  failed,
}: {
  club: MyFanClubClub;
  numbers?: FanClubNumbers;
  failed: boolean;
}) {
  const single = isLargeText(useWindowDimensions().fontScale);
  const stats: Stat[] = [
    {
      key: 'links',
      label: t('fanClub.manager.panel.links'),
      note: t('fanClub.manager.panel.linksNote'),
    },
    {
      key: 'visits',
      label: t('fanClub.manager.panel.visits'),
      note: t('fanClub.manager.panel.visitsNote'),
    },
    {
      key: 'signups',
      label: t('fanClub.manager.panel.signups'),
      note: t('fanClub.manager.panel.signupsNote'),
    },
    {
      key: 'joins',
      label: t('fanClub.manager.panel.joins'),
      note: t('fanClub.manager.panel.joinsNote', { artist: club.artistName }),
    },
  ];
  return (
    <View style={styles.grid} testID="fan-club-numbers">
      {stats.map((stat) => (
        <View key={stat.key} style={single ? styles.full : styles.half}>
          <StatCard stat={stat} value={numbers ? numbers[stat.key] : null} failed={failed} />
        </View>
      ))}
    </View>
  );
}

/**
 * "Engajamento em 30 dias" (37.9, item 8, e 37.11): a taxa (as reações novas e
 * os comentários dos fãs nos últimos 30 dias, sobre os seguidores de agora),
 * as partes e a frase de que ela não decide prêmio (decisão 7 de 36.1). Sem
 * seguidor, "Sem seguidores ainda". Fica fora do `StatGrid`, cujo `Stat.key` é
 * das 4 chaves da divulgação, e só aparece com o servidor da Fase 2, que manda
 * o `engagement`. Um foco só, sem toque.
 */
function EngagementCard({ numbers }: { numbers: FanClubNumbers }) {
  const { engagement } = numbers;
  if (!engagement) return null;
  const rate = engagement.rate30d;
  const value = rate === null ? t('fanClub.manager.panel.engagementNoFollowers') : rateText(rate);
  const parts =
    rate === null
      ? null
      : t('fanClub.manager.panel.engagementParts', {
          reactions: reactionsSpoken(engagement.reactions30d),
          comments: commentsSpoken(engagement.comments30d),
          followers: followersText(numbers.followers),
        });
  const note = t('fanClub.manager.panel.engagementNote');
  return (
    <Card
      variant="compact"
      accessible
      accessibilityLabel={t('fanClub.manager.panel.engagementLabel', {
        value,
        details: parts ? `${parts}. ${note}` : note,
      })}
      style={styles.engagement}
      testID="fan-club-engagement"
    >
      <Text variant="overline" color={colors.textMuted}>
        {t('fanClub.manager.panel.engagement')}
      </Text>
      {rate === null ? (
        <Text variant="label" color={colors.textSecondary}>
          {value}
        </Text>
      ) : (
        <Text variant="numberDate" color={colors.points}>
          {value}
        </Text>
      )}
      {parts ? (
        <Text variant="caption" color={colors.textSecondary}>
          {parts}
        </Text>
      ) : null}
      <Text variant="caption" color={colors.textMuted}>
        {note}
      </Text>
    </Card>
  );
}

interface ShortcutProps {
  icon: LucideIcon;
  title: string;
  body: string;
  accessibilityLabel: string;
  accessibilityHint: string;
  tone: 'accent' | 'plain';
  onPress: () => void;
  testID: string;
}

/**
 * Um card que leva a outra aba: o de Prêmios no rosa tingido do "#3" da 4a, o
 * das publicações no escuro dos outros. Um foco só, com a dica da aba.
 */
function Shortcut({
  icon,
  title,
  body,
  accessibilityLabel,
  accessibilityHint,
  tone,
  onPress,
  testID,
}: ShortcutProps) {
  return (
    <Card
      variant="compact"
      onPress={onPress}
      haptic="tap"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={[styles.shortcut, tone === 'accent' && styles.shortcutAccent]}
      testID={testID}
    >
      <Icon icon={icon} color={tone === 'accent' ? colors.text : colors.textSecondary} />
      <View style={styles.shortcutTexts}>
        <Text variant="label">{title}</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {body}
        </Text>
      </View>
      <Icon icon={ChevronRight} size={CHEVRON_SIZE} color={colors.textMuted} />
    </Card>
  );
}

export interface ManagerPanelProps {
  mine: MyFanClub;
  club: MyFanClubClub;
  /** Só no encerrado: quando vem a próxima candidatura. */
  next: NextRound | null;
  onOpen: (tab: ManagerTab, filter?: PostFilter) => void;
}

/**
 * O Painel do modo gestor (a 4a do Claude Design, só com o que o fã-clube já
 * tem): os avisos de hoje, cada um com a sua ação, o Destaque, o card grande
 * dos seguidores, os quatro números da divulgação (o `GET
 * /me/fan-club/numbers`, que só manda totais: sem gráfico, sem os filtros de
 * período e sem quem trouxe quem), o "Engajamento em 30 dias" (seção 37,
 * 37.11), a falha deles com "Tentar de novo", o card
 * que leva a Prêmios e o resumo que leva a Publicações. O encerrado continua
 * aqui, com os números (o servidor os dá em qualquer status, 34.22, etapa 3),
 * o aviso de que acabou e a próxima rodada.
 */
export function ManagerPanel({ mine, club, next, onOpen }: ManagerPanelProps) {
  const numbers = useMyFanClubNumbersQuery(true);
  // A leitura dos números falhou: os cards dizem "Sem dado", e não carregando.
  const failed = numbers.isError && !numbers.data;
  const closed = club.status === 'closed';
  const prizes = lastRewardText(club.lastReward);
  const posts = {
    published: formatNumber(club.postCount),
    pending: formatNumber(club.pendingPosts),
    max: FAN_CLUB_PENDING_MAX,
  };

  return (
    <View style={styles.root} testID="fan-club-dashboard">
      <UnavailableNotice club={club} next={next} />
      {club.rulesOutdated && !closed ? <RulesNotice mine={mine} /> : null}
      {club.featuredUntil ? (
        <Pill
          label={t('fanClub.mine.featured', { date: formatDayKey(club.featuredUntil) })}
          accessibilityLabel={t('fanClub.mine.featured', {
            date: formatDayKey(club.featuredUntil),
          })}
          tone="accentStrong"
          size="sm"
          style={styles.featured}
          testID="fan-club-featured"
        />
      ) : null}
      <FollowersCard numbers={numbers.data} failed={failed} />
      <StatGrid club={club} numbers={numbers.data} failed={failed} />
      {numbers.data ? <EngagementCard numbers={numbers.data} /> : null}
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
      <Shortcut
        icon={Gift}
        title={t('fanClub.manager.panel.prizes')}
        body={prizes}
        accessibilityLabel={t('fanClub.manager.panel.prizesLabel', { text: prizes })}
        accessibilityHint={t('fanClub.manager.panel.prizesHint')}
        tone="accent"
        onPress={() => onOpen('premios')}
        testID="fan-club-prizes-shortcut"
      />
      <Shortcut
        icon={FileText}
        title={t('fanClub.manager.tabs.posts')}
        body={t('fanClub.manager.panel.posts', posts)}
        accessibilityLabel={t('fanClub.manager.panel.postsLabel', posts)}
        accessibilityHint={t('fanClub.manager.panel.postsHint')}
        tone="plain"
        onPress={() => onOpen('publicacoes')}
        testID="fan-club-posts-summary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.listGap,
    paddingTop: spacing.sm,
  },
  acceptRow: {
    flexDirection: 'row',
  },
  // Com a fonte grande, o rótulo quebra dentro da largura do aviso.
  shrink: {
    flexShrink: 1,
  },
  featured: {
    alignSelf: 'flex-start',
  },
  followers: {
    gap: spacing.sm,
  },
  recent: {
    alignSelf: 'flex-start',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.tileGap,
  },
  // Duas por linha, com o vão entre elas.
  half: {
    flexBasis: '47%',
    flexGrow: 1,
  },
  full: {
    flexBasis: '100%',
  },
  stat: {
    flex: 1,
    gap: spacing.xxs,
  },
  statLabel: {
    marginTop: spacing.xs,
  },
  engagement: {
    gap: spacing.xxs,
  },
  numbersError: {
    alignItems: 'flex-start',
  },
  shortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  shortcutAccent: {
    backgroundColor: withAlpha(colors.accent, tints.faint.fill),
    borderColor: withAlpha(colors.accent, tints.faint.border),
    borderRadius: radii.cta,
  },
  shortcutTexts: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
});
