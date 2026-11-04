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
  /**
   * Em duas linhas: o nome (com o selo) em cima e, embaixo dele, o @ e o
   * horário. Na Início (pedido do dono de 03/11/2026, 37.19), onde o card é
   * estreito, e na tela da publicação (no mesmo dia, 37.20); na página do
   * fã-clube, numa linha só.
   */
  stacked?: boolean;
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
 * para baixo dele. Na Início e na tela da publicação (o `stacked`, 37.19 e
 * 37.20), o @ e o horário ficam sempre na linha de baixo do nome.
 */
export function FanClubPostAuthor({
  post,
  now,
  official,
  stacked = false,
  onOpen,
  style,
  testID,
}: FanClubPostAuthorProps) {
  const largeText = isLargeText(useWindowDimensions().fontScale);
  const { author } = post;
  const name = authorName(author);
  const lines = largeText ? undefined : 1;
  const label = postAuthorLabel(author, official);
  const hasHandle = !!(author.name && author.username);
  const time = formatPostTime(post.publishedAt, now);
  const lineStyle = [stacked ? styles.stackLine : styles.line, largeText && styles.lineWrap];

  const handle = hasHandle ? (
    <Text variant="caption" color={colors.textMuted} numberOfLines={lines} style={styles.shrink}>
      {`@${author.username}`}
    </Text>
  ) : null;
  const when = (
    <Text variant="caption" color={colors.textMuted} testID={testID ? `${testID}-time` : undefined}>
      {/* Sozinho na linha de baixo (sem o @), o horário vem sem o ponto. */}
      {stacked && !hasHandle ? time : t('post.meta', { time })}
    </Text>
  );
  const nameLine = (
    <View style={lineStyle} testID={testID ? `${testID}-line` : undefined}>
      <Text variant="label" numberOfLines={lines} style={styles.shrink}>
        {name}
      </Text>
      {official ? <OfficialBadge testID={testID ? `${testID}-official` : undefined} /> : null}
      {stacked ? null : handle}
      {stacked ? null : when}
    </View>
  );

  const content = (
    <>
      <Avatar
        name={author.name ?? author.username}
        id={author.uid}
        photoUrl={author.photoURL}
        size="lg"
      />
      {stacked ? (
        <View style={styles.stack}>
          {nameLine}
          <View style={lineStyle} testID={testID ? `${testID}-meta` : undefined}>
            {handle}
            {when}
          </View>
        </View>
      ) : (
        nameLine
      )}
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
  // O nome em cima e, embaixo, o @ e o horário (o `stacked`, na Início e na publicação).
  stack: {
    flex: 1,
    minWidth: 0,
  },
  // Cada linha do `stacked` ocupa a largura da coluna, sem o `flex` da altura.
  stackLine: {
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
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
