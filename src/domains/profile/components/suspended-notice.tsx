import { ShieldAlert } from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Card } from '@/components/card';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { SUPPORT_EMAIL } from '@/config/links';
import { t, type TranslationKey } from '@/i18n';
import { openSupportEmail } from '@/services/web-page';
import { colors, spacing } from '@/theme';

import { useSuspension } from '../hooks/use-suspension';
import type { SuspensionReason } from '../types';

const ICON_SIZE = 20;

/**
 * O texto próprio de cada motivo ("Motivo: envio de spam."): os rótulos da
 * denúncia dariam "Motivo: Ofensivo.". Com `other` ou sem motivo, a linha some.
 */
const REASON_KEYS: Partial<Record<SuspensionReason, TranslationKey>> = {
  spam: 'suspension.reasons.spam',
  offensive: 'suspension.reasons.offensive',
  harassment: 'suspension.reasons.harassment',
};

export interface SuspensionContactProps {
  style?: StyleProp<ViewStyle>;
  /** O alinhamento do link e do endereço: no centro nos avisos das sheets. */
  align?: 'start' | 'center';
  /**
   * O assunto do e-mail: o da conta suspensa, por padrão, ou o do texto
   * recusado pelo filtro (`contentFilter.mailSubject`, seção 30).
   */
  subject?: TranslationKey;
}

/**
 * "Escrever para a equipe": o link irmão das frases da conta suspensa (o
 * aviso fixo, o compositor, as sheets, o resgate, o convite e a edição do
 * perfil) e das do texto recusado pelo filtro (o compositor e a edição do
 * perfil, seção 30). Abre o app de e-mail com o assunto e nenhum dado do fã;
 * sem app de e-mail, mostra o endereço (selecionável) e o anuncia (29.1,
 * decisão 15).
 */
export function SuspensionContact({
  style,
  align = 'start',
  subject = 'suspension.mailSubject',
}: SuspensionContactProps) {
  const [failed, setFailed] = useState(false);
  const fallback = t('settings.contactError', { email: SUPPORT_EMAIL });

  const write = async (): Promise<void> => {
    const opened = await openSupportEmail(t(subject));
    setFailed(!opened);
    if (!opened) AccessibilityInfo.announceForAccessibility(fallback);
  };

  return (
    <View style={[align === 'center' ? styles.center : styles.start, style]}>
      <TextLink
        label={t('suspension.contact')}
        role="link"
        accessibilityHint={t('settings.contactHint')}
        onPress={() => void write()}
        testID="suspension-contact"
      />
      {failed ? (
        <Text
          variant="caption"
          color={colors.textSecondary}
          selectable
          style={align === 'center' ? styles.centered : undefined}
          testID="suspension-contact-error"
        >
          {fallback}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * O aviso fixo da conta suspensa, no topo da 1b, da 1e e dos Ajustes, só com
 * a suspensão: o que o fã ainda faz, o motivo e o
 * link "Escrever para a equipe". O card não é pressável, e o link é o único
 * alvo dentro dele.
 */
export function SuspendedNotice({ style }: { style?: StyleProp<ViewStyle> }) {
  const { suspended, reason } = useSuspension();
  if (!suspended) return null;
  const reasonKey = reason ? REASON_KEYS[reason] : undefined;

  return (
    <Card style={style} testID="suspended-notice">
      <View style={styles.row}>
        <Icon icon={ShieldAlert} size={ICON_SIZE} color={colors.danger} />
        <View style={styles.texts}>
          <Text variant="label" accessibilityRole="header">
            {t('suspension.title')}
          </Text>
          <Text variant="bodySmall" color={colors.textBody}>
            {t('suspension.text')}
          </Text>
          {reasonKey ? (
            <Text variant="bodySmall" color={colors.textSecondary}>
              {t('suspension.reason', { reason: t(reasonKey) })}
            </Text>
          ) : null}
          <SuspensionContact />
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  texts: {
    flex: 1,
    gap: spacing.xs,
  },
  start: {
    alignItems: 'flex-start',
  },
  center: {
    alignItems: 'center',
  },
  centered: {
    textAlign: 'center',
  },
});
