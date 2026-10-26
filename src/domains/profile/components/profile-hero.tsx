import type { ReactNode } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Avatar } from '@/components/avatar';
import { ProgressRing } from '@/components/progress-ring';
import { Skeleton } from '@/components/skeleton';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, spacing, typography } from '@/theme';

import { heroLabel, profileMeta } from '../describe-profile';
import type { Level } from '../types';

// Anel de 96 com traço de 3 em volta do avatar de 84: a folga de 3 entre os
// dois sai sozinha (o traço vai de 45 a 48 do centro, o avatar tem raio 42).
const RING_SIZE = 96;
const RING_STROKE = 3;
const NAME_SKELETON_WIDTH = 170;
// Com a fonte padrão, o nome (até 60 caracteres) cabe em até três linhas na
// coluna ao lado do avatar, mesmo num aparelho de 360 de largura.
const NAME_LINES = 3;

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

export interface ProfileHeroProps {
  /** Uid, para a mesma cor de avatar da home e do ranking. */
  uid: string | null;
  /** `null` sem nome visível: o hero mostra o nome de reserva. */
  name: string | null;
  photoURL: string | null;
  username: string | null;
  city: string | null;
  /** A bio do perfil (seção 28), embaixo do avatar; sem bio, a linha não aparece. */
  bio?: string | null;
  /** O perfil ainda não chegou e não há nome na sessão: o nome vira esqueleto. */
  loading?: boolean;
  /** `null` enquanto o nível carrega (ou se ele não veio). */
  level: Level | null;
  /** Caminho até o próximo nível, de 0 a 1: o anel anda junto com a barra do nível. */
  levelFraction: number;
  /** Os números do fã, ao lado do avatar, embaixo do nome. */
  numbers?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Vai no nome, o elemento do leitor de tela. */
  testID?: string;
}

/**
 * Topo da 1e no molde do perfil do Instagram, como o dono mostrou nas
 * capturas: o avatar à esquerda, dentro do anel de nível (lima, XP de nível
 * que nunca cai), e ao lado dele o nome, o @ e a cidade do perfil do
 * Firestore e, embaixo deles, os números do fã; a bio fica embaixo do avatar.
 * Com a fonte grande, tudo segue ao lado do avatar e cresce na altura: o
 * nome e os números quebram linha em vez de cortar.
 *
 * Para o leitor, o avatar e o anel ficam de fora, e o nome é um elemento só
 * ("Camila Ribeiro, @camilarib, Feira de Santana, BA. Nível 7, Purainha."),
 * com o nível que o selo mostra mais abaixo; os números e a bio vêm depois,
 * na ordem da tela, e o progresso é lido na barra do nível.
 *
 * O anel sobe de 0 ao valor quando o nível chega, junto com a barra do nível.
 * Na subida de nível, o anel recomeça do 0 (`restartKey`, sem remontar o
 * Canvas do Skia, que piscaria) e a barra também: os dois recomeçam juntos.
 *
 * O nome não é cortado com a fonte maior do sistema: o hero cresce na altura.
 */
export function ProfileHero({
  uid,
  name,
  photoURL,
  username,
  city,
  bio = null,
  loading = false,
  level,
  levelFraction,
  numbers,
  style,
  testID,
}: ProfileHeroProps) {
  const { fontScale } = useWindowDimensions();
  const shownName = name ?? t('profile.fallbackName');
  const meta = loading ? null : profileMeta(username, city);
  const label = loading
    ? t('profile.loading')
    : heroLabel({ name: shownName, username, city, level });

  return (
    <View style={style}>
      <View testID={testID ? `${testID}-top` : undefined} style={styles.top}>
        <View {...hiddenFromReader}>
          <ProgressRing
            restartKey={level?.number ?? null}
            progress={level ? levelFraction : 0}
            size={RING_SIZE}
            strokeWidth={RING_STROKE}
            trackColor={colors.trackStrong}
          >
            <Avatar name={name} id={uid ?? 'me'} photoUrl={photoURL} size="hero" />
          </ProgressRing>
        </View>
        <View style={styles.beside}>
          <View
            testID={testID}
            accessible
            accessibilityLabel={label}
            accessibilityState={loading ? { busy: true } : undefined}
          >
            {loading ? (
              <Skeleton height={typography.titleHeader.lineHeight} width={NAME_SKELETON_WIDTH} />
            ) : (
              <Text variant="titleHeader" numberOfLines={fontScale > 1 ? undefined : NAME_LINES}>
                {shownName}
              </Text>
            )}
            {meta ? (
              <Text variant="caption" color={colors.textMuted} style={styles.meta}>
                {meta}
              </Text>
            ) : null}
          </View>
          {numbers ? <View style={styles.below}>{numbers}</View> : null}
        </View>
      </View>
      {bio && !loading ? (
        <Text variant="body" style={styles.below}>
          {bio}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // A sobra entre o anel e o que fica ao lado, como o vão do avatar aos números no Instagram.
  beside: {
    flex: 1,
    marginLeft: spacing.lg,
  },
  below: {
    marginTop: spacing.md,
  },
  meta: {
    marginTop: spacing.xxs,
  },
});
