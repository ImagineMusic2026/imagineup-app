import type { Ref } from 'react';
import { StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { Card } from '@/components/card';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text, type TextInstance } from '@/components/text';
import { TextLink } from '@/components/text-link';
import {
  entryName,
  ExampleNotice,
  type LeaderboardEntry,
  type RankingSelf,
} from '@/domains/ranking';
import { t } from '@/i18n';
import { colors, layout, radii, spacing, typography } from '@/theme';
import { formatNumber, formatPointsSpoken } from '@/utils/number';
import { firstNameAndInitial } from '@/utils/text';

const PLACES = [1, 2, 3] as const;
// O link de 44 fica no meio da linha do título, sem esticá-la.
const LINK_OUTSET = (layout.minTouchTarget - typography.micro.lineHeight) / 2;
const NAME_SKELETON_WIDTH = 56;
const POINTS_SKELETON_WIDTH = 36;

export type TopFansState = 'loading' | 'ready';

export interface TopFansCardProps {
  /** As três primeiras posições do ranking da temporada na central (as mesmas da aba Ranking). */
  entries: readonly LeaderboardEntry[];
  state: TopFansState;
  /** O fã que está vendo: na posição dele, o avatar e o "você" são os dele. */
  self: RankingSelf;
  /** "Ver ranking": escolhe a aba Ranking desta página e rola até as abas. */
  onSeeRanking: () => void;
  /** O título, para levar o foco do leitor de tela até ele (o Mural escolhido pela barra grudada). */
  titleRef?: Ref<TextInstance>;
  /**
   * O ranking é de exemplo ao lado das centrais do servidor
   * (`LeaderboardPage.example`): o aviso logo abaixo do título.
   */
  example?: boolean;
}

function placeLabel(position: number): string {
  return t('ranking.a11y.place', { position });
}

function FanCell({ entry, self }: { entry: LeaderboardEntry; self: RankingSelf }) {
  const first = entry.position === 1;
  const person = entry.isMe
    ? self
    : { id: entry.userId, name: entry.displayName, photoUrl: entry.photoURL };
  const name = entry.isMe ? t('ranking.you') : firstNameAndInitial(entryName(entry));
  const points = formatPointsSpoken(entry.points);
  const label = entry.isMe
    ? t('artist.topFans.cellMe', { place: placeLabel(entry.position), points })
    : t('artist.topFans.cell', { place: placeLabel(entry.position), name, points });

  return (
    <Card
      variant="inset"
      highlight={first}
      accessible
      accessibilityLabel={label}
      testID={`artist-top-fan-${entry.position}`}
      style={styles.cell}
    >
      <Text
        variant="chipSmall"
        color={first ? colors.points : colors.textMuted}
        tabular
        style={styles.place}
      >
        {t('artist.topFans.place', { position: entry.position })}
      </Text>
      <Avatar
        name={person.name}
        id={person.id}
        photoUrl={person.photoUrl}
        size="sm"
        ring={entry.isMe ? 'self' : 'none'}
        style={styles.avatar}
      />
      <Text variant="labelTiny" numberOfLines={1}>
        {name}
      </Text>
      <Text
        variant="pointsTiny"
        color={first ? colors.points : colors.textSubtle}
        tabular
        style={styles.points}
      >
        {formatNumber(entry.points)}
      </Text>
    </Card>
  );
}

/** Menos de três fãs pontuaram: o lugar fica tracejado, "Vaga aberta". */
function VacantCell({ position }: { position: number }) {
  return (
    <Card
      variant="dashed"
      accessible
      accessibilityLabel={t('artist.topFans.vacantLabel', { place: placeLabel(position) })}
      style={[styles.cell, styles.vacant]}
    >
      <Text variant="chipSmall" color={colors.textMuted}>
        {t('artist.topFans.place', { position })}
      </Text>
      <Text variant="labelTiny" color={colors.textMuted} style={styles.vacantText}>
        {t('artist.topFans.vacant')}
      </Text>
    </Card>
  );
}

function LoadingCells() {
  return (
    <SkeletonGroup accessibilityLabel={t('artist.topFans.loading')} style={styles.cells}>
      {PLACES.map((place) => (
        <View key={place} style={[styles.cell, styles.skeletonCell]}>
          <Skeleton circle height={layout.avatar.sm.size} tone="raised" />
          <Skeleton
            tone="line"
            width={NAME_SKELETON_WIDTH}
            height={typography.labelTiny.fontSize}
          />
          <Skeleton
            tone="line"
            width={POINTS_SKELETON_WIDTH}
            height={typography.pointsTiny.fontSize}
          />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/**
 * "Top fãs da temporada" da página do artista (1d): os três primeiros do
 * ranking da temporada na central, a mesma fonte da aba Ranking e da 1f (o
 * protótipo diz "da semana", mas os números são os da temporada, e o título
 * acompanha). O 1º em lima. Cada lugar é um elemento só para o leitor. Com
 * erro, quem chama não mostra o card; o resto da página continua.
 */
export function TopFansCard({
  entries,
  state,
  self,
  onSeeRanking,
  titleRef,
  example = false,
}: TopFansCardProps) {
  const byPlace = new Map(entries.map((entry) => [entry.position, entry]));

  return (
    <Card style={styles.card} testID="artist-top-fans">
      <View style={styles.header}>
        {/* Caixa alta no texto, não no estilo: no Android o textTransform mede a
            linha em minúsculas e corta o fim dela. */}
        <Text
          ref={titleRef}
          variant="chip"
          accessibilityRole="header"
          accessibilityLabel={t('artist.topFans.title')}
          style={styles.title}
        >
          {t('artist.topFans.title').toUpperCase()}
        </Text>
        <TextLink
          label={t('artist.topFans.seeRanking')}
          textVariant="micro"
          accessibilityLabel={t('artist.topFans.seeRankingLabel')}
          accessibilityHint={t('artist.topFans.seeRankingHint')}
          onPress={onSeeRanking}
          style={styles.link}
          testID="artist-see-ranking"
        />
      </View>
      {example ? <ExampleNotice style={styles.notice} testID="artist-top-fans-example" /> : null}
      {state === 'loading' ? (
        <LoadingCells />
      ) : (
        <View style={styles.cells}>
          {PLACES.map((place) => {
            const entry = byPlace.get(place);
            return entry ? (
              <FanCell key={place} entry={entry} self={self} />
            ) : (
              <VacantCell key={place} position={place} />
            );
          })}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.gutter,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  // Entre o título e os lugares, sem somar ao respiro do título.
  notice: {
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  // Com flexShrink, o Android media o título mais estreito do que desenha e cortava a última palavra.
  title: {
    flex: 1,
  },
  link: {
    marginVertical: -LINK_OUTSET,
  },
  cells: {
    flexDirection: 'row',
    gap: spacing.tileGap,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
  },
  place: {
    marginBottom: spacing.chipGap,
  },
  avatar: {
    marginBottom: spacing.chipGap,
  },
  points: {
    marginTop: spacing.xs,
  },
  vacant: {
    justifyContent: 'center',
    paddingVertical: spacing.listGap,
    paddingHorizontal: spacing.sm,
  },
  vacantText: {
    marginTop: spacing.chipGap,
  },
  skeletonCell: {
    gap: spacing.chipGap,
    paddingVertical: spacing.listGap,
    borderRadius: radii.sm,
    backgroundColor: colors.background,
  },
});
