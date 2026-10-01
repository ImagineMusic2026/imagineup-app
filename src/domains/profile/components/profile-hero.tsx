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
import { colors, radii, spacing, typography } from '@/theme';

import { heroLabel, profileMeta } from '../describe-profile';
import type { Level } from '../types';
import { LevelBadge } from './level-badge';

// Anel de 96 com traço de 3 em volta do avatar de 84: a folga de 3 entre os
// dois sai sozinha (o traço vai de 45 a 48 do centro, o avatar tem raio 42).
const RING_SIZE = 96;
const RING_STROKE = 3;
// Tamanho do selo enquanto o nível carrega (o "NÍVEL 7 · PURAINHA" do protótipo).
const BADGE_SKELETON = { width: 150, height: 23 };
const NAME_SKELETON_WIDTH = 170;
// Com a fonte padrão, o nome (até 60 caracteres) fica em até duas linhas.
const NAME_LINES = 2;

export interface ProfileHeroProps {
  /** Uid, para a mesma cor de avatar da home e do ranking. */
  uid: string | null;
  /** `null` sem nome visível: o hero mostra o nome de reserva. */
  name: string | null;
  photoURL: string | null;
  username: string | null;
  city: string | null;
  /** O perfil ainda não chegou e não há nome na sessão: o nome vira esqueleto. */
  loading?: boolean;
  /** `null` enquanto o nível carrega (ou se ele não veio). */
  level: Level | null;
  /** Caminho até o próximo nível, de 0 a 1: o anel anda junto com a barra do card de pontos. */
  levelFraction: number;
  /** Muda a cada subida de nível que o fã vê (`useLevelUp`). */
  celebration?: number | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Topo da 1e: avatar dentro do anel de nível (lima, XP de nível que nunca
 * cai), nome, @ e cidade do perfil do Firestore e o selo do nível. Um
 * elemento só para o leitor de tela ("Camila Ribeiro, @camilarib, Feira de
 * Santana, BA. Nível 7, Purainha."); o progresso é lido no card de pontos.
 *
 * O anel sobe de 0 ao valor quando o nível chega, junto com a barra do card
 * de pontos, que nasce nessa hora. Na subida de nível, o anel recomeça do 0
 * (`restartKey`, sem remontar o Canvas do Skia, que piscaria) e a barra
 * também: os dois recomeçam juntos.
 *
 * O nome não é cortado com a fonte maior do sistema: o hero cresce na altura.
 */
export function ProfileHero({
  uid,
  name,
  photoURL,
  username,
  city,
  loading = false,
  level,
  levelFraction,
  celebration = null,
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
    <View
      testID={testID}
      accessible
      accessibilityLabel={label}
      accessibilityState={loading ? { busy: true } : undefined}
      style={[styles.hero, style]}
    >
      <ProgressRing
        restartKey={level?.number ?? null}
        progress={level ? levelFraction : 0}
        size={RING_SIZE}
        strokeWidth={RING_STROKE}
        trackColor={colors.trackStrong}
      >
        <Avatar name={name} id={uid ?? 'me'} photoUrl={photoURL} size="hero" />
      </ProgressRing>
      {loading ? (
        <Skeleton
          height={typography.titleCard.lineHeight}
          width={NAME_SKELETON_WIDTH}
          style={styles.name}
        />
      ) : (
        <Text
          variant="titleCard"
          numberOfLines={fontScale > 1 ? undefined : NAME_LINES}
          style={[styles.name, styles.centered]}
        >
          {shownName}
        </Text>
      )}
      {meta ? (
        <Text variant="caption" color={colors.textMuted} style={[styles.meta, styles.centered]}>
          {meta}
        </Text>
      ) : null}
      {level ? (
        <LevelBadge level={level} celebration={celebration} style={styles.badge} />
      ) : (
        <Skeleton
          height={BADGE_SKELETON.height}
          width={BADGE_SKELETON.width}
          radius={radii.pill}
          style={styles.badge}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    alignItems: 'center',
  },
  // 13 do anel ao nome no protótipo.
  name: {
    marginTop: spacing.rowGap,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  badge: {
    marginTop: spacing.md,
  },
  centered: {
    textAlign: 'center',
    maxWidth: '100%',
  },
});
