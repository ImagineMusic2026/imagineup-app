import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { Glyph } from '@/components/glyph';
import { IconTile } from '@/components/icon-tile';
import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors, layout, spacing } from '@/theme';

import { useOpenSocialLink } from '../hooks/use-open-social-link';
import { linksOpen, socialLinksOf, socialLinkText, type SocialLink } from '../social-links';
import type { FanSocials } from '../types';

// O quadro de 38 fica no meio do alvo de 44: a fileira recua a sobra, para o
// primeiro ícone alinhar com a bio.
const TARGET_SLACK = (layout.minTouchTarget - layout.iconTile) / 2;

function SocialTile({ link }: { link: SocialLink }) {
  return (
    <IconTile
      tone="glass"
      renderIcon={({ size }) => (
        <Glyph name={link.network} size={size} color={colors.textSecondary} />
      )}
    />
  );
}

export interface SocialIconsProps {
  /** As redes do perfil do fã; sem nenhuma que passe no padrão, nada aparece. */
  socials: FanSocials | null | undefined;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * As redes do fã no topo da 1e, embaixo da bio, como o link do perfil do
 * Instagram (pedido do dono de 26/10/2026): um ícone por rede preenchida, na
 * ordem da lista fixa, que abre o perfil na rede, fora do app. Cada ícone é
 * um link para o leitor ("Instagram, @camila.teste.up", com a dica "Abre o
 * perfil no Instagram, fora do app"), num alvo de 44.
 *
 * Nas fixtures e no emulador, os links não abrem (os usuários de exemplo
 * podem ser de um estranho, 28.1, decisão 25): os ícones ficam sem toque,
 * lidos com o mesmo rótulo, e o aviso de exemplo diz por quê, como no perfil
 * público. A falha ao abrir mostra o aviso embaixo, anunciado.
 */
export function SocialIcons({ socials, style, testID }: SocialIconsProps) {
  const links = socialLinksOf(socials);
  const opens = linksOpen();
  const { open, failed } = useOpenSocialLink();

  if (links.length === 0) return null;

  return (
    <View testID={testID} style={style}>
      <View style={styles.row}>
        {links.map((link) => {
          const { network, handle } = socialLinkText(link);
          const label = t('fanProfile.socialLabel', { network, handle });
          const testId = `profile-social-${link.network}`;
          return opens ? (
            <PressableScale
              key={link.network}
              onPress={() => open(link.url)}
              accessibilityRole="link"
              accessibilityLabel={label}
              accessibilityHint={t('fanProfile.socialHint', { network })}
              testID={testId}
              style={styles.target}
            >
              <SocialTile link={link} />
            </PressableScale>
          ) : (
            <View
              key={link.network}
              accessible
              accessibilityLabel={label}
              testID={testId}
              style={styles.target}
            >
              <SocialTile link={link} />
            </View>
          );
        })}
      </View>
      {opens ? null : (
        <Text variant="caption" color={colors.textMuted} style={styles.footnote}>
          {t('fanProfile.sampleLinks')}
        </Text>
      )}
      {failed ? (
        <Text variant="caption" color={colors.danger} style={styles.footnote}>
          {t('fanProfile.openError')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -TARGET_SLACK,
  },
  target: {
    width: layout.minTouchTarget,
    height: layout.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: {
    marginTop: spacing.xs,
  },
});
