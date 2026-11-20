import { ChevronLeft } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { t } from '@/i18n';
import { borderWidths, colors, layout, opacities, radii, spacing } from '@/theme';

export interface StepFooterProps {
  /** Sem ele, só o botão (o estágio do convite recusado). */
  onBack?: () => void;
  /** Enquanto a conta está sendo criada, a pergunta não pode ser deixada no meio. */
  backDisabled?: boolean;
  label: string;
  onPress: () => void;
  loading?: boolean;
  /** Apagado enquanto o campo está vazio. */
  disabled?: boolean;
  /** Por que o botão está apagado ("Preencha o campo para continuar."). */
  accessibilityHint?: string;
}

// O voltar é um círculo da altura do botão ao lado, com a seta do `BackButton`.
const BACK_SIZE = layout.buttonHeight.lg;
const BACK_ICON_SIZE = 20;
const BACK_ICON_STROKE = 2.2;

/**
 * Pé das perguntas da entrada, preso acima do teclado: o voltar redondo de
 * vidro e o botão que avança, lado a lado. O voltar é da pergunta, e não da
 * pilha (quem decide para onde ele vai é a tela), e por isso mora aqui, perto
 * do polegar, e não num header. O botão é o `Button` de sempre, sem o toque
 * dele: o do envio sai do resultado (sucesso ou erro).
 */
export function StepFooter({
  onBack,
  backDisabled = false,
  label,
  onPress,
  loading = false,
  disabled = false,
  accessibilityHint,
}: StepFooterProps) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <PressableScale
          onPress={onBack}
          disabled={backDisabled}
          accessibilityLabel={t('common.back')}
          style={[styles.back, backDisabled && styles.inactive]}
        >
          <View style={styles.circle}>
            <Icon icon={ChevronLeft} size={BACK_ICON_SIZE} strokeWidth={BACK_ICON_STROKE} />
          </View>
        </PressableScale>
      ) : null}
      <Button
        label={label}
        onPress={onPress}
        loading={loading}
        disabled={disabled}
        haptic={null}
        accessibilityHint={accessibilityHint}
        style={styles.action}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
  },
  inactive: {
    opacity: opacities.disabled,
  },
  circle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    borderWidth: borderWidths.default,
    borderColor: colors.borderGlass,
    backgroundColor: colors.glass,
  },
  // O resto da fileira; com a fonte grande, o rótulo quebra e o botão cresce.
  action: {
    flex: 1,
  },
});
