import {
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, isLargeText, layout, spacing } from '@/theme';
import { formatPostTime } from '@/utils/date';

import type { FanClubPerson, FanClubPost } from '../types';
import { OfficialBadge } from './official-badge';

export interface FanClubPostAuthorProps {
  post: Pick<FanClubPost, 'author' | 'publishedAt'>;
  /**
   * O selo do fã-clube oficial ao lado do nome (34.23). Na Início, fica só ao
   * lado do nome do fã-clube, logo em cima, e aqui vem desligado.
   */
  official: boolean;
  /** Relógio da tela (`useNow`), para o "3 h" andar sozinho. */
  now: Date;
  /** Abre o perfil público do autor; sem ele (a própria publicação), o autor só se lê. */
  onOpen?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** O nome que o topo mostra: o nome, o @ ou "Fã". */
function authorName({ name, username }: FanClubPerson): string {
  return name ?? (username ? `@${username}` : t('profile.fallbackName'));
}

/**
 * O autor para o leitor de tela: o nome, o @ e, no fã-clube oficial, o que o
 * selo diz ("Thalita Santos, @thalitasan, gestor do fã-clube oficial"). O
 * horário fica no rótulo do corpo ("Publicado há 3 horas"), que vem logo
 * depois, para o leitor não ouvir duas vezes.
 */
export function postAuthorLabel(author: FanClubPerson, official: boolean): string {
  const parts = [authorName(author)];
  if (author.name && author.username) parts.push(`@${author.username}`);
  if (official) parts.push(t('fanClub.post.authorOfficial'));
  return parts.join(', ');
}

/**
 * O topo do card da publicação (03/11/2026, a pedido do dono, na página, na
 * Início e na tela da publicação), no estilo do X: o avatar à esquerda e, ao
 * lado, numa linha só, o nome em negrito, o selo do fã-clube oficial (34.23;
 * o gestor é fã, e a roseta de verificado é só do artista), o @ em cor
 * secundária e " · 3 h" (`formatPostTime`: o relativo no primeiro dia, depois
 * a data). No molde do autor do comentário (`FanClubCommentRow`), com o
 * avatar do autor do post do Mural: um pressável só, que abre o perfil
 * público. Com a fonte grande, o nome não corta, e o @ e o horário descem
 * para baixo dele.
 */
export function FanClubPostAuthor({
  post,
  now,
  official,
  onOpen,
  style,
  testID,
}: FanClubPostAuthorProps) {
  const largeText = isLargeText(useWindowDimensions().fontScale);
  const { author } = post;
  const name = authorName(author);
  const lines = largeText ? undefined : 1;
  const label = postAuthorLabel(author, official);

  const content = (
    <>
      <Avatar
        name={author.name ?? author.username}
        id={author.uid}
        photoUrl={author.photoURL}
        size="lg"
      />
      <View
        style={[styles.line, largeText && styles.lineWrap]}
        testID={testID ? `${testID}-line` : undefined}
      >
        <Text variant="label" numberOfLines={lines} style={styles.shrink}>
          {name}
        </Text>
        {official ? <OfficialBadge testID={testID ? `${testID}-official` : undefined} /> : null}
        {author.name && author.username ? (
          <Text
            variant="caption"
            color={colors.textMuted}
            numberOfLines={lines}
            style={styles.shrink}
          >
            {`@${author.username}`}
          </Text>
        ) : null}
        <Text
          variant="caption"
          color={colors.textMuted}
          testID={testID ? `${testID}-time` : undefined}
        >
          {t('post.meta', { time: formatPostTime(post.publishedAt, now) })}
        </Text>
      </View>
    </>
  );

  if (!onOpen) {
    return (
      <View accessible accessibilityLabel={label} style={[styles.row, style]} testID={testID}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={t('fanProfile.openHint', { name })}
      style={[styles.row, style]}
      testID={testID}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Um alvo de 44, com o avatar e a linha no meio dele.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    minHeight: layout.minTouchTarget,
  },
  line: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
  },
  lineWrap: {
    flexWrap: 'wrap',
  },
  shrink: {
    flexShrink: 1,
  },
});
