import { Check, ChevronRight, UserRound } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, isLargeText, layout, motion, spacing } from '@/theme';
import { selectionAccessibility } from '@/utils/selection-accessibility';

import { GENDERS } from '../details';
import type { Gender } from '../types';
import { Expandable, useExpandProgress } from './expandable';

const ICON_SIZE = 18;
const CHEVRON_SIZE = 18;

/** O nome de cada gênero na tela. */
export const GENDER_LABEL_KEYS: Readonly<Record<Gender, TranslationKey>> = {
  woman: 'editProfile.details.genders.woman',
  man: 'editProfile.details.genders.man',
  nonbinary: 'editProfile.details.genders.nonbinary',
  undisclosed: 'editProfile.details.genders.undisclosed',
};

/** O gênero escrito: "Mulher", ou "Não informado" sem escolha. */
export function genderText(gender: Gender | null): string {
  return t(gender ? GENDER_LABEL_KEYS[gender] : 'editProfile.details.genderUnset');
}

export interface GenderFieldProps {
  value: Gender | null;
  onChange: (gender: Gender) => void;
  /** Só leitura (o fã suspenso): a linha mostra o valor, sem abrir. */
  readOnly?: boolean;
}

/**
 * O gênero na tela "Editar perfil" (seção 28): uma linha com o valor à
 * direita e a seta, que gira para baixo quando abre as quatro opções embaixo
 * (as da decisão do dono; o app não volta a "Não informado"). A linha é um
 * botão só, com o rótulo "Gênero, Mulher. Só você e a equipe do ImagineUP
 * veem." e o `expanded`; o valor e a seta ficam fora do leitor. As opções
 * ficam sempre montadas e medidas, e a altura anda por valor animado. Cada
 * opção é rádio no Android e botão com "selecionado" no iOS. Escolher fecha e
 * devolve o foco do leitor à linha. Com a fonte a partir de 1,3 (`isLargeText`),
 * o valor desce para baixo do título, no recuo dele.
 */
export function GenderField({ value, onChange, readOnly = false }: GenderFieldProps) {
  const [open, setOpen] = useState(false);
  const progress = useExpandProgress(open);
  const row = useRef<View>(null);
  const stacked = isLargeText(useWindowDimensions().fontScale);
  const valueText = genderText(value);
  const label = `${t('editProfile.details.genderLabel', { value: valueText })}. ${t(
    'editProfile.details.genderMeta',
  )}`;

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${progress.get() * 90}deg` }],
  }));

  const choose = (gender: Gender): void => {
    onChange(gender);
    setOpen(false);
    // Depois do toque, o foco do leitor volta à linha, que agora diz o valor novo.
    setTimeout(() => {
      if (row.current) AccessibilityInfo.sendAccessibilityEvent(row.current, 'focus');
    }, motion.duration.fast);
  };

  const trailing = (
    <View
      style={[styles.trailing, stacked && styles.trailingBelow]}
      testID="edit-profile-gender-value"
    >
      <Text variant="caption" color={colors.textSecondary}>
        {valueText}
      </Text>
      {readOnly ? null : (
        <Animated.View style={chevronStyle}>
          <Icon icon={ChevronRight} size={CHEVRON_SIZE} color={colors.textMuted} />
        </Animated.View>
      )}
    </View>
  );
  const common = {
    title: t('editProfile.details.gender'),
    meta: t('editProfile.details.genderMeta'),
    leading: <Icon icon={UserRound} size={ICON_SIZE} color={colors.textMuted} />,
    variant: 'divided' as const,
    trailing,
    trailingPlacement: stacked ? ('below' as const) : ('end' as const),
    accessibilityLabel: label,
    style: styles.row,
    testID: 'edit-profile-gender',
  };

  if (readOnly) return <ListRow {...common} />;

  return (
    <View>
      <ListRow
        {...common}
        ref={row}
        onPress={() => setOpen((current) => !current)}
        accessibilityState={{ expanded: open }}
      />
      <Expandable open={open} progress={progress} testID="edit-profile-gender-options">
        <View style={styles.options}>
          {GENDERS.map((gender) => {
            const selected = gender === value;
            const { role, state } = selectionAccessibility('radio', selected);
            return (
              <PressableScale
                key={gender}
                onPress={() => choose(gender)}
                haptic="selection"
                accessibilityRole={role}
                accessibilityState={state}
                accessibilityLabel={t(GENDER_LABEL_KEYS[gender])}
                style={styles.option}
                testID={`edit-profile-gender-${gender}`}
              >
                <Text variant="body" color={colors.text} style={styles.optionText}>
                  {t(GENDER_LABEL_KEYS[gender])}
                </Text>
                {selected ? <Icon icon={Check} size={ICON_SIZE} color={colors.accent} /> : null}
              </PressableScale>
            );
          })}
        </View>
      </Expandable>
    </View>
  );
}

const styles = StyleSheet.create({
  // A divisória entre as linhas do card é do card (`FormGroup`).
  row: {
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 0,
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  // Embaixo do título, o valor fica no recuo do título e da meta, como as
  // opções; na borda da linha, embaixo do ícone, ele parecia solto da linha.
  trailingBelow: {
    paddingLeft: ICON_SIZE + spacing.itemGap,
  },
  options: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
  },
  // Alinhadas ao título da linha, depois do ícone.
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
    paddingLeft: ICON_SIZE + spacing.itemGap,
    gap: spacing.sm,
  },
  optionText: {
    flex: 1,
  },
});
