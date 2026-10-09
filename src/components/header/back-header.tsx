import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { layout } from '@/theme';

import { BackButton } from './back-button';

export interface BackHeaderProps {
  title?: string;
  onBack?: () => void;
  /**
   * O botão da esquerda: a seta de voltar (padrão) ou o "×" de fechar, que a
   * tela "Editar perfil" usa ("Fechar", colado na margem da esquerda).
   */
  leading?: 'back' | 'close';
  /** O botão da esquerda desligado, enquanto a tela não pode sair (o perfil salvando). */
  backDisabled?: boolean;
  /** Ação à direita (compartilhar, mais opções, o ✓ de salvar). */
  right?: ReactNode;
}

/** Header fixo das telas empilhadas: voltar (ou fechar), título centralizado e ação opcional. */
export function BackHeader({
  title,
  onBack,
  leading = 'back',
  backDisabled = false,
  right,
}: BackHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.side}>
        <BackButton variant={leading} align="start" onPress={onBack} disabled={backDisabled} />
      </View>
      {title ? (
        <Text
          variant="headingSection"
          numberOfLines={1}
          accessibilityRole="header"
          style={styles.title}
        >
          {title}
        </Text>
      ) : (
        <View style={styles.title} />
      )}
      <View style={[styles.side, styles.right]}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  // O alvo de 44 do voltar já dá a altura: o círculo fica no mesmo lugar de antes.
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: layout.minTouchTarget,
  },
  side: {
    width: layout.minTouchTarget,
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
  },
});
