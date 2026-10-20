import { Flag, Share2 } from 'lucide-react-native';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { PressableScale } from '@/components/pressable-scale';
import { RemoteImage } from '@/components/remote-image';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, radii, spacing } from '@/theme';
import { formatRelativeAgo, formatRelativeAgoSpoken } from '@/utils/date';

import { excerptOf } from '../format';
import type { FanClubPost } from '../types';
import { UnofficialBand } from './unofficial-band';

/** A foto do fã-clube é sempre 4:5 (decisão 15). */
const PHOTO_ASPECT = 4 / 5;
// A miniatura ao lado do texto, no cartão da Início.
const THUMB_WIDTH = 72;
// O texto do cartão da Início fica em 4 linhas; o leitor ouve o texto inteiro.
const FEED_TEXT_LINES = 4;

export type FanClubPostCardVariant = 'page' | 'feed';

export interface FanClubPostCardProps {
  post: FanClubPost;
  /** Relógio da tela (`useNow`), para o "há 2 h" andar sozinho. */
  now: Date;
  /**
   * - `page`: na página do fã-clube, o texto inteiro e a foto grande;
   * - `feed`: na Início, com a faixa e o nome do fã-clube (que abrem a página),
   *   o texto em 4 linhas e a miniatura ao lado.
   */
  variant: FanClubPostCardVariant;
  /** Quem vê não é o gestor: o Denunciar aparece (a própria publicação não se denuncia). */
  canReport: boolean;
  onShare: (post: FanClubPost) => void;
  onReport: (post: FanClubPost) => void;
  /** Só na Início: a faixa e o nome abrem a página do fã-clube. */
  onOpenClub?: (post: FanClubPost) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Uma publicação no ar de um fã-clube (34.9, itens 7 e 9). O texto, a foto e
 * a data são um foco só; o Compartilhar (o link do fã-clube, sem link próprio
 * por publicação) e o Denunciar são botões irmãos, nunca dentro de outro
 * pressável. Na Início, a faixa "Fã-clube, não oficial" vem antes do nome, e
 * os dois abrem a página.
 */
export function FanClubPostCard({
  post,
  now,
  variant,
  canReport,
  onShare,
  onReport,
  onOpenClub,
  style,
  testID,
}: FanClubPostCardProps) {
  const feed = variant === 'feed';
  const image = feed ? (post.thumb ?? post.photo) : (post.photo ?? post.thumb);
  const when = formatRelativeAgoSpoken(post.publishedAt, now);
  // Os botões dizem de qual publicação são: na página, todos são do mesmo fã-clube.
  const excerpt = excerptOf(post.text);
  const label = t(post.kind === 'photo' ? 'fanClub.post.labelPhoto' : 'fanClub.post.label', {
    text: post.text,
    when,
  });

  return (
    <Card style={[styles.card, style]} testID={testID}>
      {feed && onOpenClub ? (
        <PressableScale
          onPress={() => onOpenClub(post)}
          accessibilityRole="link"
          accessibilityLabel={t('fanClub.post.openClub', { name: post.clubName })}
          accessibilityHint={t('fanClub.post.openClubHint')}
          style={styles.club}
          testID={testID ? `${testID}-club` : undefined}
        >
          <UnofficialBand />
          <Text variant="label">{post.clubName}</Text>
        </PressableScale>
      ) : null}
      <View accessible accessibilityLabel={label} style={feed ? styles.feedBody : undefined}>
        <View style={feed ? styles.feedText : undefined}>
          <Text variant="body" numberOfLines={feed ? FEED_TEXT_LINES : undefined}>
            {post.text}
          </Text>
          <Text variant="caption" color={colors.textMuted} style={styles.when}>
            {formatRelativeAgo(post.publishedAt, now)}
          </Text>
        </View>
        {image ? (
          <RemoteImage
            uri={image.url}
            fallback={{ kind: 'surface', seed: post.id }}
            style={feed ? styles.thumb : styles.photo}
          />
        ) : null}
      </View>
      <View style={styles.actions}>
        <Button
          label={t('fanClub.post.share')}
          variant="ghost"
          size="sm"
          icon={Share2}
          onPress={() => onShare(post)}
          accessibilityLabel={t('fanClub.post.shareLabel', { name: post.clubName, excerpt })}
          testID={testID ? `${testID}-share` : undefined}
        />
        {canReport ? (
          <Button
            label={t('fanClub.post.report')}
            variant="ghost"
            size="sm"
            icon={Flag}
            onPress={() => onReport(post)}
            accessibilityLabel={t('fanClub.post.reportLabel', { excerpt })}
            accessibilityHint={t('fanClub.post.reportHint')}
            testID={testID ? `${testID}-report` : undefined}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
  },
  // O alvo de toque inteiro, mesmo com o nome numa linha só.
  club: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: layout.minTouchTarget,
  },
  feedBody: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  feedText: {
    flex: 1,
    minWidth: 0,
  },
  when: {
    marginTop: spacing.xs,
  },
  photo: {
    alignSelf: 'stretch',
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.lg,
    marginTop: spacing.md,
  },
  thumb: {
    width: THUMB_WIDTH,
    aspectRatio: PHOTO_ASPECT,
    borderRadius: radii.sm,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
