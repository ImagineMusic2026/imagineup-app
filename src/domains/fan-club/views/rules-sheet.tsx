import { router } from 'expo-router';
import { Check } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/header';
import { Icon } from '@/components/icon';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { TERMS_URL } from '@/config/links';
import { t, type TranslationKey } from '@/i18n';
import { openWebPage } from '@/services/web-page';
import { colors, spacing } from '@/theme';

import { OfficialBadge } from '../components/official-badge';
import { useShownFanClub } from '../queries';

const CHECK_SIZE = 16;

// As condições de ter um fã-clube (34.1, decisões 8, 46 e 52): o que a
// candidatura pede e o que o fã-clube pede para continuar no ar.
const WHO: readonly TranslationKey[] = [
  'fanClub.rulesSheet.who.adult',
  'fanClub.rulesSheet.who.central',
  'fanClub.rulesSheet.who.username',
  'fanClub.rulesSheet.who.keep',
];

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/**
 * Sheet "Regras do fã-clube" (`/meu-fa-clube/regras`), aberta pela
 * apresentação, na altura do conteúdo, no visual do "Gerar meu link": quem
 * pode ter um fã-clube, o que é o selo de oficial (34.23: o único lugar do app
 * que explica que o fã-clube é um espaço de fãs, sem rotular cada um como não
 * oficial) e, só com o `notice` do servidor, o texto inteiro do
 * reconhecimento, com o aviso de que a Apple não patrocina (decisão 47 e a
 * regra 5.3 da App Store: as regras ficam dentro do app). Embaixo, o link dos
 * Termos de Uso, ou do regulamento quando ele existir (decisão 8).
 *
 * O estado vem da mesma consulta da apresentação, já em cache. Aberta a frio,
 * a consulta é a própria trava: sem o programa à vista, a sheet fecha.
 */
export function FanClubRulesSheetScreen() {
  const insets = useSafeAreaInsets();
  const [standalone] = useState(() => !router.canGoBack());
  const { query, mine } = useShownFanClub();
  const settledWithout = !mine && !query.isPending;

  useEffect(() => {
    if (settledWithout) closeSheet();
  }, [settledWithout]);

  if (!mine) return null;
  const regulation = mine.rulesUrl !== null;

  return (
    <View style={styles.root} testID="fan-club-rules-sheet">
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('fanClub.rulesSheet.title')}
        </Text>
        <BackButton variant="close" onPress={closeSheet} />
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={[
          styles.body,
          { paddingBottom: Math.max(insets.bottom, spacing.lg) },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.firstSection}>
          <Text variant="label" accessibilityRole="header">
            {t('fanClub.rulesSheet.whoTitle')}
          </Text>
          {WHO.map((key) => (
            <View key={key} style={styles.item}>
              <View style={styles.check}>
                <Icon icon={Check} size={CHECK_SIZE} color={colors.accent} />
              </View>
              <Text variant="body" color={colors.textSecondary} style={styles.itemText}>
                {t(key)}
              </Text>
            </View>
          ))}
        </View>
        <View style={styles.section} testID="fan-club-rules-official">
          <Text variant="label" accessibilityRole="header">
            {t('fanClub.rulesSheet.officialTitle')}
          </Text>
          <View style={styles.item}>
            <View style={styles.check}>
              <OfficialBadge size={16} />
            </View>
            <Text variant="body" color={colors.textSecondary} style={styles.itemText}>
              {t('fanClub.rulesSheet.official')}
            </Text>
          </View>
        </View>
        {mine.notice ? (
          <View style={styles.section} testID="fan-club-rules-notice">
            <Text variant="label" accessibilityRole="header">
              {t('fanClub.rulesSheet.noticeTitle')}
            </Text>
            <Text variant="body" color={colors.textSecondary}>
              {mine.notice}
            </Text>
          </View>
        ) : null}
        <TextLink
          label={t(regulation ? 'fanClub.apply.readRegulation' : 'fanClub.apply.readTerms')}
          role="link"
          onPress={() => openWebPage(mine.rulesUrl ?? TERMS_URL)}
          style={styles.read}
          testID="fan-club-rules-read"
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  // A sheet tem a altura do conteúdo (`fitToContents`): nada de `flex: 1` na
  // raiz nem na lista, senão ela não tem altura para medir.
  root: {
    backgroundColor: colors.surface,
  },
  fill: {
    flexGrow: 0,
    flexShrink: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.gutter,
  },
  title: {
    flex: 1,
  },
  body: {
    paddingHorizontal: spacing.gutter,
    paddingTop: spacing.md,
  },
  firstSection: {
    gap: spacing.sm,
  },
  section: {
    marginTop: spacing.sectionTop,
    gap: spacing.sm,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  // O sinal na altura da primeira linha do texto.
  check: {
    marginTop: spacing.xxs,
  },
  itemText: {
    flex: 1,
  },
  read: {
    alignSelf: 'flex-start',
    marginTop: spacing.md,
  },
});
