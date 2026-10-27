import { router } from 'expo-router';
import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';

import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { fanProfileHref } from '@/domains/profile';
import { t } from '@/i18n';
import { colors, type TypographyVariant } from '@/theme';

import { mentionSegments, mentionTargets } from '../mentions';
import type { FanClubMention } from '../types';

// O texto com @ do fã-clube (seção 37, 37.7 e 37.9, item 7): os trechos das
// marcações conferidas como links em linha. O @ de fã abre o perfil público
// (`fanProfileHref`); o de central, pela função de quem usa, porque a tela
// por cima das abas fecha e abre a central na aba (`openArtistOverStack`), e
// a Início, dentro da aba, empilha nela.

/** O trecho do texto que vira link fica na variante de peso 700 do mesmo tamanho. */
const LINK_VARIANT: Partial<Record<TypographyVariant, TypographyVariant>> = {
  body: 'label',
  bodySmall: 'labelCompact',
};

/** Abre o que a marcação aponta: o perfil do fã ou, pela função de quem usa, a central. */
export function openMention(mention: FanClubMention, onOpenArtist: (artistId: string) => void) {
  if (mention.kind === 'artist') {
    onOpenArtist(mention.id);
    return;
  }
  router.push(fanProfileHref(mention.id));
}

export interface MentionTextProps {
  text: string;
  mentions: readonly FanClubMention[] | undefined;
  /** Abre a central do @: por cima das abas, `openArtistOverStack`; na Início, o `push` na aba. */
  onOpenArtist: (artistId: string) => void;
  variant?: 'body' | 'bodySmall';
  color?: string;
  numberOfLines?: number;
  testID?: string;
}

/**
 * O texto com as marcações como `TextLink` em linha: o leitor de tela acha cada
 * link pelo rotor (iOS) e pelo menu de links (Android), porque o texto não está
 * dentro de um pressável. No card, que é um foco só, os links ficam só para
 * quem vê, e o leitor os alcança pelas ações do corpo (`mentionActions`).
 */
export function MentionText({
  text,
  mentions,
  onOpenArtist,
  variant = 'body',
  color = colors.text,
  numberOfLines,
  testID,
}: MentionTextProps) {
  const segments = mentionSegments(text, mentions);
  return (
    <Text variant={variant} color={color} numberOfLines={numberOfLines} testID={testID}>
      {segments.map((segment, index) => {
        const { mention } = segment;
        if (!mention) return segment.text;
        return (
          <TextLink
            // A posição no texto não muda enquanto o texto é o mesmo.
            key={`${mention.start}-${mention.id}`}
            variant="inline"
            label={segment.text}
            textVariant={LINK_VARIANT[variant] ?? 'label'}
            onPress={() => openMention(mention, onOpenArtist)}
            testID={testID ? `${testID}-mention-${index}` : undefined}
          />
        );
      })}
    </Text>
  );
}

/**
 * As ações do corpo do card (37.9, item 2): uma por @ marcado ("Abrir o perfil
 * de @fulano" e "Abrir a central de @artista"), porque um link dentro do
 * corpo agrupado não seria alcançável. Sem marcação, nenhuma.
 */
export function mentionActions(
  text: string,
  mentions: readonly FanClubMention[] | undefined,
  onOpenArtist: (artistId: string) => void,
): {
  accessibilityActions: AccessibilityActionInfo[] | undefined;
  onAccessibilityAction: ((event: AccessibilityActionEvent) => void) | undefined;
} {
  const targets = mentionTargets(text, mentions);
  if (targets.length === 0) {
    return { accessibilityActions: undefined, onAccessibilityAction: undefined };
  }
  const name = (index: number) => `mention-${index}`;
  return {
    accessibilityActions: targets.map((mention, index) => ({
      name: name(index),
      label: t(
        mention.kind === 'artist' ? 'fanClub.mentions.openArtist' : 'fanClub.mentions.openFan',
        { handle: mention.handle },
      ),
    })),
    onAccessibilityAction: (event) => {
      const index = targets.findIndex(
        (_, position) => name(position) === event.nativeEvent.actionName,
      );
      const mention = targets[index];
      if (mention) openMention(mention, onOpenArtist);
    },
  };
}
