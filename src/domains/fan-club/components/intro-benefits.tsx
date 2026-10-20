import {
  ChartColumn,
  Gift,
  Link2,
  Star,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, spacing } from '@/theme';

type BenefitKey = 'page' | 'central' | 'link' | 'numbers' | 'featured' | 'reward';
type Benefit = { key: BenefitKey; icon: LucideIcon };

// O reconhecimento fica por último e longe dos números: o prêmio nunca aparece
// ligado a seguidores nem a cadastros (decisão 47).
const BENEFITS: readonly Benefit[] = [
  { key: 'page', icon: Users },
  { key: 'central', icon: UserPlus },
  { key: 'link', icon: Link2 },
  { key: 'numbers', icon: ChartColumn },
  { key: 'featured', icon: Star },
  { key: 'reward', icon: Gift },
];

const ICON_SIZE = 22;

const titleKey = (key: BenefitKey) => `fanClub.intro.benefits.${key}.title` as TranslationKey;
const bodyKey = (key: BenefitKey) => `fanClub.intro.benefits.${key}.body` as TranslationKey;

function BenefitRow({ benefit }: { benefit: Benefit }) {
  const title = t(titleKey(benefit.key));
  const body = t(bodyKey(benefit.key));
  return (
    <View
      accessible
      accessibilityLabel={t('fanClub.intro.benefitLabel', { title, body })}
      style={styles.row}
      testID={`fan-club-intro-benefit-${benefit.key}`}
    >
      <View style={styles.icon}>
        <Icon icon={benefit.icon} size={ICON_SIZE} color={colors.accent} />
      </View>
      <View style={styles.texts}>
        <Text variant="label" style={styles.caps}>
          {title}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {body}
        </Text>
      </View>
    </View>
  );
}

export interface IntroBenefitsProps {
  /**
   * O texto do reconhecimento (`notice`). A linha do reconhecimento só aparece
   * com ele: trocá-lo por `null` no servidor tira o prêmio da tela sem build
   * (decisão 47).
   */
  notice: string | null;
}

/**
 * "Vantagens de ter um fã-clube" na apresentação: uma linha por vantagem, com
 * o ícone em rosa, o título em caixa alta e uma frase. Cada linha é um foco
 * só, lida como frase ("Seu link. Compartilhe o link..."): a caixa alta é só
 * do desenho.
 */
export function IntroBenefits({ notice }: IntroBenefitsProps) {
  const shown = notice ? BENEFITS : BENEFITS.filter((benefit) => benefit.key !== 'reward');
  return (
    <View style={styles.root} testID="fan-club-intro-benefits">
      <Text variant="titleHeader" accessibilityRole="header">
        {t('fanClub.intro.benefitsTitle')}
      </Text>
      <View style={styles.list}>
        {shown.map((benefit) => (
          <BenefitRow key={benefit.key} benefit={benefit} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.blockGap,
  },
  list: {
    gap: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  // O ícone na altura da primeira linha do título.
  icon: {
    marginTop: -spacing.xxs,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
  caps: {
    textTransform: 'uppercase',
  },
});
