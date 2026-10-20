import { router } from 'expo-router';
import { Camera, ClipboardCheck, Link2, Send, Users, type LucideIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { IconTile } from '@/components/icon-tile';
import { StepProgress } from '@/components/step-progress';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, motion, spacing } from '@/theme';

import { UnofficialBand } from './unofficial-band';

type Step = { key: 'apply' | 'review' | 'page' | 'posts' | 'share'; icon: LucideIcon };

// Os 5 passos da apresentação, sem dinheiro (34.9, item 2).
const STEPS: readonly Step[] = [
  { key: 'apply', icon: Send },
  { key: 'review', icon: ClipboardCheck },
  { key: 'page', icon: Users },
  { key: 'posts', icon: Camera },
  { key: 'share', icon: Link2 },
];

const titleKey = (step: Step) => `fanClub.intro.steps.${step.key}.title` as TranslationKey;
const bodyKey = (step: Step) => `fanClub.intro.steps.${step.key}.body` as TranslationKey;

export interface IntroStepsProps {
  /** O texto do reconhecimento (`notice`), só quando o servidor o manda (decisão 47). */
  notice: string | null;
}

/**
 * A apresentação do fã-clube (34.9, item 2): os 5 passos, um de cada vez, com
 * a barra de etapas; "Continuar" mostra o próximo e, no último, abre a
 * candidatura, e "Pular" abre a candidatura de qualquer passo. Embaixo, as
 * condições e, só com o `notice`, o texto do reconhecimento. O passo é um foco
 * só ("Passo 2 de 5. ..."), que recebe o foco e é anunciado quando muda.
 */
export function IntroSteps({ notice }: IntroStepsProps) {
  const [index, setIndex] = useState(0);
  const stepRef = useRef<View>(null);
  const step = STEPS[index]!;
  const last = index === STEPS.length - 1;
  const label = t('fanClub.intro.stepLabel', {
    current: index + 1,
    total: STEPS.length,
    title: t(titleKey(step)),
    body: t(bodyKey(step)),
  });

  const apply = () => router.push('/meu-fa-clube/candidatura');
  const next = () => {
    if (last) {
      apply();
      return;
    }
    setIndex(index + 1);
    // O foco do leitor vai ao passo novo, que diz "Passo N de 5" com o texto dele.
    setTimeout(() => {
      if (stepRef.current) AccessibilityInfo.sendAccessibilityEvent(stepRef.current, 'focus');
    }, motion.duration.fast);
  };

  return (
    <View style={styles.root} testID="fan-club-intro">
      <UnofficialBand />
      <Text variant="bodyLead" color={colors.textSecondary} style={styles.lead}>
        {t('fanClub.intro.lead')}
      </Text>
      {/* A barra só desenha: o passo já diz "Passo N de 5" ao leitor. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.progress}
      >
        <StepProgress total={STEPS.length} current={index + 1} testID="fan-club-intro-progress" />
      </View>
      <Card
        ref={stepRef}
        variant="large"
        accessible
        accessibilityLabel={label}
        style={styles.step}
        testID="fan-club-intro-step"
      >
        <IconTile icon={step.icon} tone="action" />
        <Text variant="titleCard">{t(titleKey(step))}</Text>
        <Text variant="body" color={colors.textSecondary}>
          {t(bodyKey(step))}
        </Text>
      </Card>
      <View style={styles.actions}>
        <Button
          label={t('fanClub.intro.next')}
          onPress={next}
          accessibilityHint={t(last ? 'fanClub.intro.applyHint' : 'fanClub.intro.nextHint')}
          testID="fan-club-intro-next"
        />
        {last ? null : (
          <Button
            label={t('fanClub.intro.skip')}
            variant="ghost"
            onPress={apply}
            accessibilityHint={t('fanClub.intro.applyHint')}
            testID="fan-club-intro-skip"
          />
        )}
      </View>
      <View style={styles.info}>
        <Text variant="label" accessibilityRole="header">
          {t('fanClub.intro.conditionsTitle')}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.intro.conditions')}
        </Text>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanClub.intro.requirements')}
        </Text>
      </View>
      {notice ? (
        <View style={styles.info} testID="fan-club-intro-notice">
          <Text variant="label" accessibilityRole="header">
            {t('fanClub.intro.noticeTitle')}
          </Text>
          <Text variant="body" color={colors.textSecondary}>
            {notice}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'stretch',
  },
  lead: {
    marginTop: spacing.md,
  },
  progress: {
    marginTop: spacing.xl,
  },
  step: {
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  actions: {
    marginTop: spacing.xl,
    gap: spacing.listGap,
  },
  info: {
    marginTop: spacing.sectionTop,
    gap: spacing.sm,
  },
});
