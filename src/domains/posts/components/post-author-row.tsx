import { router, useNavigationContainerRef } from 'expo-router';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { Avatar } from '@/components/avatar';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { VerifiedBadge } from '@/components/verified-badge';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';
import { formatRelativeAgo, formatRelativeAgoSpoken } from '@/utils/date';

import { LARGE_TEXT_SCALE } from '../consts';
import type { Post } from '../types';

export interface PostAuthorRowProps {
  post: Pick<Post, 'artist' | 'createdAt'>;
  /** Relógio da tela (`useNow`), para o "há 2 h" andar sozinho. */
  now: Date;
}

// O protótipo tem 14 em cima porque vem depois de uma borda; aqui vem do header.
const PADDING_TOP = spacing.listGap;
const PADDING_BOTTOM = spacing.gridGap;

/** A central do artista dentro de cada aba (rota compartilhada). */
const ARTIST_IN_TAB = {
  '(inicio)': '/(tabs)/(inicio)/artista/[artistaId]',
  '(explorar)': '/(tabs)/(explorar)/artista/[artistaId]',
  '(ranking)': '/(tabs)/(ranking)/artista/[artistaId]',
  '(perfil)': '/(tabs)/(perfil)/artista/[artistaId]',
} as const;

type TabGroup = keyof typeof ARTIST_IN_TAB;

interface NavState {
  index?: number;
  routes?: readonly { name: string; state?: NavState }[];
}

/** A aba em foco debaixo do post, procurada na árvore de navegação. */
export function focusedTab(state: NavState | undefined): TabGroup | null {
  for (const route of state?.routes ?? []) {
    if (route.name === '(tabs)') {
      const tabs = route.state;
      const name = tabs?.routes?.[tabs.index ?? 0]?.name;
      return name && name in ARTIST_IN_TAB ? (name as TabGroup) : null;
    }
    const nested = focusedTab(route.state);
    if (nested) return nested;
  }
  return null;
}

/**
 * Autor do post (da 1a): avatar de 38, nome com o selo e "Artista Imagine · há
 * 2 h". A linha inteira é um pressável que abre a central do artista, e o
 * leitor de tela ouve tudo numa frase só, com o tempo por extenso. Com a fonte
 * grande (1,3 em diante), nome e meta quebram em linhas em vez de cortar.
 */
export function PostAuthorRow({ post, now }: PostAuthorRowProps) {
  const navigation = useNavigationContainerRef();
  const { artist } = post;
  const lines = useWindowDimensions().fontScale >= LARGE_TEXT_SCALE ? undefined : 1;

  // O post fica fora das abas, por cima delas. `push` e `navigate` empilhariam
  // outra árvore de abas em cima do post; o `dismissTo` fecha o post e abre a
  // central na aba que já existe, com a raiz dela embaixo (`withAnchor`). Sem o
  // grupo no endereço, o Expo Router escolheria a aba pelos segmentos do post
  // (nenhum) e cairia na Explorar: vai a aba de onde o fã veio, ou o Início.
  const openArtist = (): void => {
    const tab = focusedTab(navigation.getRootState() as NavState | undefined) ?? '(inicio)';
    router.dismissTo(
      { pathname: ARTIST_IN_TAB[tab], params: { artistaId: artist.id } },
      { withAnchor: true },
    );
  };
  const role = t('post.details.artistRole');
  const author = artist.verified ? t('post.author', { name: artist.name }) : artist.name;

  return (
    <PressableScale
      onPress={openArtist}
      accessibilityLabel={t('post.details.authorLabel', {
        author,
        role,
        time: formatRelativeAgoSpoken(post.createdAt, now),
      })}
      accessibilityHint={t('post.details.authorHint')}
      style={styles.row}
    >
      <Avatar name={artist.name} id={artist.id} photoUrl={artist.photoURL} size="lg" />
      <View style={styles.text}>
        <View style={styles.name}>
          <Text variant="label" numberOfLines={lines} style={styles.shrink}>
            {artist.name}
          </Text>
          {artist.verified ? <VerifiedBadge size={14} /> : null}
        </View>
        <Text variant="caption" color={colors.textMuted} numberOfLines={lines}>
          {t('post.details.authorMeta', { role, time: formatRelativeAgo(post.createdAt, now) })}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.listGap,
    minHeight: layout.minTouchTarget,
    paddingHorizontal: spacing.gutter,
    paddingTop: PADDING_TOP,
    paddingBottom: PADDING_BOTTOM,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xxs,
  },
  name: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.iconLabelGap,
  },
  shrink: {
    flexShrink: 1,
  },
});
