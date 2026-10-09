import { StyleSheet, View } from 'react-native';

import { SectionLabel } from '@/components/section-label';
import { Text } from '@/components/text';
import { t, type TranslationKey } from '@/i18n';
import { colors, spacing } from '@/theme';

import { SOCIAL_NETWORKS } from '../details';
import { SOCIAL_LABEL_KEYS } from '../schemas';
import type { FanProfile, SocialNetwork } from '../types';
import { FormGroup } from './form-group';
import { genderText } from './gender-field';

/** O que vem antes do usuário de cada rede ("@thalita.teste.up", "in/thalita-teste"). */
export const SOCIAL_PREFIX: Readonly<Record<SocialNetwork, string>> = {
  instagram: '@',
  tiktok: '@',
  linkedin: 'in/',
  x: '@',
};

function ReadOnlyRow({ title, value }: { title: string; value: string | null }) {
  const shown = value ?? t('editProfile.readOnlyEmpty');
  return (
    <View accessible accessibilityLabel={`${title}, ${shown}`} style={styles.row}>
      <Text variant="labelSmall" color={colors.textSecondary}>
        {title}
      </Text>
      <Text variant="body" color={value ? colors.textBody : colors.textMuted}>
        {shown}
      </Text>
    </View>
  );
}

const titleOf = (key: TranslationKey): string => t(key);

/**
 * O perfil só para ver, sem a API (24.1, decisão 12; seção 28, decisão 12): os
 * três grupos da tela "Editar perfil" com os valores como texto, sem campos.
 * Cada linha é um foco só ("Nome, Camila Ribeiro").
 */
export function ProfileReadOnly({ profile, name }: { profile: FanProfile; name: string | null }) {
  return (
    <View testID="edit-profile-read-only">
      <SectionLabel style={styles.firstLabel}>{t('editProfile.basic.section')}</SectionLabel>
      <FormGroup>
        <ReadOnlyRow title={titleOf('editProfile.basic.name')} value={name} />
        <ReadOnlyRow
          title={titleOf('editProfile.basic.username')}
          value={profile.username ? `@${profile.username}` : null}
        />
        <ReadOnlyRow title={titleOf('editProfile.basic.bio')} value={profile.bio ?? null} />
      </FormGroup>
      <SectionLabel>{t('editProfile.details.section')}</SectionLabel>
      <FormGroup>
        <ReadOnlyRow title={titleOf('editProfile.details.city')} value={profile.city} />
        <ReadOnlyRow
          title={titleOf('editProfile.details.gender')}
          value={genderText(profile.gender ?? null)}
        />
        <ReadOnlyRow
          title={titleOf('editProfile.details.privateAccount')}
          value={t(
            profile.privateAccount
              ? 'editProfile.details.privateAccountOn'
              : 'editProfile.details.privateAccountOff',
          )}
        />
      </FormGroup>
      <SectionLabel>{t('editProfile.socials.section')}</SectionLabel>
      <FormGroup>
        {SOCIAL_NETWORKS.map((network) => {
          const handle = profile.socials?.[network] ?? null;
          return (
            <ReadOnlyRow
              key={network}
              title={t(SOCIAL_LABEL_KEYS[network])}
              value={handle ? `${SOCIAL_PREFIX[network]}${handle}` : null}
            />
          );
        })}
      </FormGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  firstLabel: {
    paddingTop: 0,
  },
  row: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
