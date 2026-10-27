import { router } from 'expo-router';
import {
  ChevronRight,
  ExternalLink,
  LogOut,
  Mail,
  ScrollText,
  type LucideIcon,
} from 'lucide-react-native';
import { useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { SUPPORT_EMAIL } from '@/config/links';
import { t, type TranslationKey } from '@/i18n';
import { openSupportEmail } from '@/services/web-page';
import { borderWidths, colors, spacing } from '@/theme';

import type { MyFanClubClub } from '../types';
import { ContactCard } from './contact-card';

const ICON_SIZE = 22;
const TRAILING_ICON_SIZE = 18;

interface RowProps {
  icon: LucideIcon;
  title: string;
  hint: string;
  onPress: () => void;
  /** A seta de "abre outra tela" ou a de "abre fora do app". */
  trailing: 'chevron' | 'external';
  danger?: boolean;
  role?: 'button' | 'link';
  testID: string;
}

/** Uma linha da Conta, no molde do menu dos Ajustes: o ícone simples, só o título e a seta. */
function Row({ icon, title, hint, onPress, trailing, danger = false, role, testID }: RowProps) {
  return (
    <ListRow
      variant="menu"
      tone={danger ? 'danger' : 'default'}
      leading={<Icon icon={icon} size={ICON_SIZE} color={danger ? colors.danger : colors.text} />}
      title={title}
      trailing={
        <Icon
          icon={trailing === 'external' ? ExternalLink : ChevronRight}
          size={TRAILING_ICON_SIZE}
          color={colors.textMuted}
        />
      }
      onPress={onPress}
      accessibilityRole={role}
      accessibilityLabel={title}
      accessibilityHint={hint}
      testID={testID}
    />
  );
}

/**
 * Uma linha que abre o app de e-mail para a equipe, com o assunto. Sem app de
 * e-mail, o endereço aparece embaixo, selecionável, e é anunciado, como o
 * "Fale com a equipe" dos Ajustes.
 */
function TeamEmailRow({
  icon,
  title,
  hint,
  subject,
  danger,
  testID,
}: {
  icon: LucideIcon;
  title: TranslationKey;
  hint: TranslationKey;
  subject: TranslationKey;
  danger?: boolean;
  testID: string;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = t('settings.contactError', { email: SUPPORT_EMAIL });

  const write = async (): Promise<void> => {
    const opened = await openSupportEmail(t(subject));
    setFailed(!opened);
    if (!opened) AccessibilityInfo.announceForAccessibility(fallback);
  };

  return (
    <View>
      <Row
        icon={icon}
        title={t(title)}
        hint={t(hint)}
        onPress={() => void write()}
        trailing="external"
        danger={danger}
        role="link"
        testID={testID}
      />
      {failed ? (
        <Text variant="caption" color={colors.textSecondary} selectable style={styles.fallback}>
          {fallback}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * A aba Conta do modo gestor (34.24): o WhatsApp que a equipe usa para falar
 * com o gestor (o `ContactCard`, com Editar), as Regras do fã-clube (a sheet
 * com as condições e o texto do reconhecimento), "Falar com a equipe" e, no
 * fim, separado, "Quero encerrar meu fã-clube", que abre o e-mail do pedido
 * (decisão 13) e some no encerrado, como o "Excluir conta" no fim do "Editar
 * perfil".
 */
export function ManagerAccount({ club }: { club: MyFanClubClub }) {
  const closed = club.status === 'closed';
  return (
    <View style={styles.root}>
      <Text variant="titlePage" accessibilityRole="header">
        {t('fanClub.manager.account.title')}
      </Text>
      {/* O card já tem o título "WhatsApp para a equipe". */}
      <ContactCard />
      <View>
        <SectionLabel>{t('fanClub.manager.account.help')}</SectionLabel>
        <Row
          icon={ScrollText}
          title={t('fanClub.manager.account.rules')}
          hint={t('fanClub.manager.account.rulesHint')}
          onPress={() => router.push('/meu-fa-clube/regras')}
          trailing="chevron"
          testID="fan-club-account-rules"
        />
        <TeamEmailRow
          icon={Mail}
          title="fanClub.manager.account.contact"
          hint="fanClub.manager.account.contactHint"
          subject="fanClub.manager.account.contactSubject"
          testID="fan-club-account-contact"
        />
      </View>
      {closed ? null : (
        <View>
          <View style={styles.divider} />
          <TeamEmailRow
            icon={LogOut}
            title="fanClub.mine.close"
            hint="fanClub.mine.closeHint"
            subject="fanClub.mine.closeSubject"
            danger
            testID="fan-club-close"
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.lg,
    paddingTop: spacing.sm,
  },
  fallback: {
    marginBottom: spacing.sm,
  },
  // De ponta a ponta, como a linha entre as seções dos Ajustes.
  divider: {
    height: borderWidths.default,
    marginBottom: spacing.sm,
    marginHorizontal: -spacing.gutter,
    backgroundColor: colors.divider,
  },
});
