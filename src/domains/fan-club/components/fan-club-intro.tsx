import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { BottomActionBar } from '@/components/bottom-action-bar';
import { Button } from '@/components/button';
import { LargeTitleHeader } from '@/components/header';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { TERMS_URL } from '@/config/links';
import { t } from '@/i18n';
import { openWebPage } from '@/services/web-page';
import { colors, spacing } from '@/theme';

import type { MyFanClub } from '../types';
import { IntroBenefits } from './intro-benefits';
import { IntroCarousel } from './intro-carousel';

/**
 * "Ao se candidatar, você aceita os Termos de Uso.", com o link dentro da
 * frase, como os termos do cadastro. Com o regulamento publicado (o `rulesUrl`),
 * a frase e o link passam a ele, como a caixa da candidatura (decisão 8).
 */
function AcceptanceNotice({ rulesUrl }: { rulesUrl: string | null }) {
  const regulation = rulesUrl !== null;
  const [before, after] = t(
    regulation ? 'fanClub.intro.regulationNotice' : 'fanClub.intro.termsNotice',
  ).split('{{link}}');
  return (
    <Text variant="caption" color={colors.textMuted} style={styles.centered}>
      {before}
      <TextLink
        variant="inline"
        tone="text"
        // Manrope 700, com a mesma entrelinha (15) do texto em volta.
        textVariant="labelCompact"
        label={t(regulation ? 'fanClub.intro.regulationLink' : 'fanClub.intro.termsLink')}
        onPress={() => openWebPage(rulesUrl ?? TERMS_URL)}
        testID="fan-club-intro-terms"
      />
      {after}
    </Text>
  );
}

export interface FanClubIntroProps {
  mine: MyFanClub;
}

/**
 * A apresentação do fã-clube (`/meu-fa-clube` sem candidatura, 34.9, item 2),
 * no molde de um programa de indicação: os passos num carrossel, as vantagens
 * e o link "Regras do fã-clube", que abre a sheet com as condições (a idade,
 * a central e o @) e o texto do reconhecimento. O botão fica preso ao pé e
 * abre a candidatura de qualquer passo, com o aceite dos termos embaixo dele.
 * Sem a faixa "Fã-clube, não oficial": ela fica nas telas públicas (pedido do
 * dono de 20/10/2026, 34.22). A tela é de ponta a ponta: o carrossel passa de
 * uma borda à outra, e o resto leva a margem.
 */
export function FanClubIntro({ mine }: FanClubIntroProps) {
  const [barHeight, setBarHeight] = useState(0);

  return (
    <View style={styles.root} testID="fan-club-intro">
      <ScrollView
        contentContainerStyle={{ paddingBottom: barHeight + spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.padded}>
          <LargeTitleHeader title={t('fanClub.intro.title')} showBack />
        </View>
        <IntroCarousel />
        <View style={[styles.padded, styles.after]}>
          <IntroBenefits notice={mine.notice} />
          <TextLink
            label={t('fanClub.intro.rules')}
            accessibilityHint={t('fanClub.intro.rulesHint')}
            onPress={() => router.push('/meu-fa-clube/regras')}
            style={styles.rules}
            testID="fan-club-intro-rules"
          />
        </View>
      </ScrollView>
      {/* O aceite fica embaixo do botão: em cima dele, cairia no começo do véu
          do rodapé, ainda transparente, por cima do que rola. */}
      <BottomActionBar onHeightChange={setBarHeight} testID="fan-club-intro-footer">
        <Button
          label={t('fanClub.intro.apply')}
          onPress={() => router.push('/meu-fa-clube/candidatura')}
          accessibilityHint={t('fanClub.intro.applyHint')}
          testID="fan-club-intro-apply"
        />
        <AcceptanceNotice rulesUrl={mine.rulesUrl} />
      </BottomActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  // O rodapé fica preso ao pé da tela, por cima da rolagem.
  root: {
    flex: 1,
  },
  padded: {
    paddingHorizontal: spacing.gutter,
  },
  after: {
    marginTop: spacing.sectionTop,
  },
  rules: {
    alignSelf: 'center',
    marginTop: spacing.xl,
  },
  centered: {
    textAlign: 'center',
  },
});
