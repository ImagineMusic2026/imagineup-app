import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { Pill } from '@/components/pill';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { t } from '@/i18n';
import { borderWidths, colors, layout, spacing } from '@/theme';

import {
  MENTION_SEARCH_DEBOUNCE_MS,
  MENTION_SEARCH_MIN,
  mentionSuggestionsFor,
  type MentionDraft,
} from '../mentions';
import { useFanClubMentionSearchQuery } from '../queries';
import type { MentionSuggestion } from '../types';

// A barra cabe três linhas e meia: a meia diz que ela rola.
const VISIBLE_ROWS = 3.5;
const MAX_HEIGHT = layout.minTouchTarget * VISIBLE_ROWS;

/** "3 sugestões", "1 sugestão". */
function countText(count: number): string {
  if (count === 1) return t('fanClub.mentions.countOne');
  return t('fanClub.mentions.count', { count });
}

/** "Marcar Thalita Santos, @thalitasan"; sem nome, "Marcar @thalitasan". */
function suggestionLabel(item: MentionSuggestion): string {
  return item.name
    ? t('fanClub.mentions.pick', { name: item.name, username: item.username })
    : t('fanClub.mentions.pickHandle', { username: item.username });
}

const ROLE_TEXTS = {
  manager: 'fanClub.comments.manager',
  artist: 'fanClub.mentions.artist',
} as const;

export interface MentionSuggestionsProps {
  clubId: string;
  /** A publicação da conversa; null na nova publicação do gestor. */
  postId: string | null;
  /** O @ que está sendo digitado antes do cursor. */
  draft: MentionDraft;
  /** A conversa (o gestor, o artista e quem comentou), pedida uma vez pelo campo. */
  conversation: readonly MentionSuggestion[];
  onPick: (item: MentionSuggestion) => void;
  /** A nova publicação põe a barra embaixo do campo, e não em cima dele. */
  style?: StyleProp<ViewStyle>;
}

/**
 * A barra das sugestões do @ (seção 37, 37.9, item 6), acima do teclado,
 * dentro do compositor: a conversa na hora, filtrada pelo começo do @, e a
 * busca a partir de 2 letras, depois de 400 ms sem tecla. Cada linha (o
 * avatar, o nome, o @ e "Gestor" ou "Artista") é um botão "Marcar {{name}},
 * @{{username}}"; a barra anuncia quantas sugestões tem quando aparece, e o
 * foco fica no campo (o toque não fecha o teclado). Nada diz quem segue (R5).
 */
export function MentionSuggestions({
  clubId,
  postId,
  draft,
  conversation,
  onPick,
  style,
}: MentionSuggestionsProps) {
  const debounced = useDebouncedValue(draft.query, MENTION_SEARCH_DEBOUNCE_MS);
  const searching =
    debounced.length >= MENTION_SEARCH_MIN && draft.query.length >= MENTION_SEARCH_MIN;
  const search = useFanClubMentionSearchQuery(clubId, postId, debounced, searching);
  const items = mentionSuggestionsFor(conversation, search.data?.items ?? [], draft.query);
  const count = items.length;

  // Anuncia quando aparece (de nenhuma para alguma), e não a cada letra.
  const shown = useRef(false);
  useEffect(() => {
    if (count > 0 && !shown.current) {
      AccessibilityInfo.announceForAccessibilityWithOptions(countText(count), { queue: true });
    }
    shown.current = count > 0;
  }, [count]);

  if (count === 0) return null;

  return (
    <ScrollView
      style={[styles.bar, style]}
      // Dentro da rolagem da nova publicação: no Android, sem isso, quem rola é a tela.
      nestedScrollEnabled
      keyboardShouldPersistTaps="always"
      showsVerticalScrollIndicator={false}
      testID="mention-suggestions"
    >
      {items.map((item) => (
        <PressableScale
          key={`${item.kind}:${item.id}`}
          onPress={() => onPick(item)}
          haptic="selection"
          accessibilityLabel={suggestionLabel(item)}
          style={styles.row}
          testID={`mention-suggestion-${item.username}`}
        >
          <Avatar
            name={item.name ?? item.username}
            id={item.id}
            photoUrl={item.photoURL}
            size="xs"
          />
          <View style={styles.texts}>
            {item.name ? (
              <Text variant="label" numberOfLines={1}>
                {item.name}
              </Text>
            ) : null}
            <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
              {`@${item.username}`}
            </Text>
          </View>
          {item.role ? <Pill label={t(ROLE_TEXTS[item.role])} size="xs" caps /> : null}
        </PressableScale>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: {
    maxHeight: MAX_HEIGHT,
    marginBottom: spacing.xs,
    borderBottomWidth: borderWidths.default,
    borderBottomColor: colors.divider,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: layout.minTouchTarget,
  },
  texts: {
    flex: 1,
    minWidth: 0,
  },
});
