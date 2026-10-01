import { router, useLocalSearchParams } from 'expo-router';
import { Share2 } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { Card } from '@/components/card';
import { BackButton } from '@/components/header';
import { Pill } from '@/components/pill';
import { SectionLabel } from '@/components/section-label';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import { Text } from '@/components/text';
import { TextLink } from '@/components/text-link';
import { useMyInviteQuery } from '@/domains/profile';
import { t } from '@/i18n';
import { colors, motion, spacing, typography } from '@/theme';
import { formatPointsDelta, formatPointsSpoken } from '@/utils/number';

import { describeInviteLink, inviteMessage } from '../describe-link';
import { useInviteTarget, type InviteParams } from '../hooks/use-invite-target';
import { shareInvite } from '../share-invite';

const CONTENT_ENTERING = FadeIn.duration(motion.duration.base);
// Largura da coluna das pílulas de pontos: a de "+10" no texto normal.
const RULE_POINTS_WIDTH = 44;

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** "+2 por pessoa que abre o link": a pílula lima é dos pontos; uma frase só para o leitor. */
function RuleRow({ points, text }: { points: number; text: string }) {
  return (
    <View
      accessible
      accessibilityLabel={`${formatPointsSpoken(points)} ${text}`}
      style={styles.rule}
    >
      <View style={styles.rulePoints}>
        <Pill label={formatPointsDelta(points)} tone="points" />
      </View>
      <Text variant="body" color={colors.textBody} style={styles.ruleText}>
        {text}
      </Text>
    </View>
  );
}

/** O quadro do link carregando, na altura do endereço e da linha do destino. */
function LinkSkeleton() {
  return (
    <SkeletonGroup accessibilityLabel={t('invite.loading')}>
      <Skeleton tone="line" width="85%" height={typography.label.lineHeight} />
      <Skeleton
        tone="line"
        width="55%"
        height={typography.caption.lineHeight}
        style={styles.meta}
      />
    </SkeletonGroup>
  );
}

/**
 * Sheet "Gerar meu link" (sem desenho no protótipo, no visual das outras
 * sheets): o link do fã com o código de convite (`?ref=`), para onde ele leva
 * e quanto rende cada pessoa trazida, com um botão que abre a folha de
 * compartilhar do sistema. Abre pelo atalho Convidar do "+" (link para o
 * app), pelo "Gerar meu link" da 1b e pelo card lima da 1g (link para o post
 * da missão) e pelo "Chamar amigos" da 1m (link para a agenda, com o show na
 * mensagem). Os pontos são creditados pela API quando alguém abre o link ou se
 * cadastra por ele, e os valores vêm do painel.
 *
 * O link é um endereço do site (o domínio próprio é a UP-46), e o
 * `+native-intent` lê o `?ref=` quando ele abre o app. Sem o código (não
 * carregou), o link sai sem ele e a tela avisa que não rende pontos. Não há
 * botão de copiar: a folha do sistema já tem o "Copiar".
 */
export function InviteSheetScreen() {
  const params = useLocalSearchParams<InviteParams>();
  const insets = useSafeAreaInsets();
  // Aberta a frio (link), a sheet é a única tela da pilha e ocupa a tela toda:
  // sem puxador, e o topo desce abaixo da barra de status.
  const [standalone] = useState(() => !router.canGoBack());
  const invite = useMyInviteQuery();
  const { target, mission } = useInviteTarget(params);
  const rules = invite.data;
  const code = rules?.code ?? null;
  // Sem o código e ainda buscando pela primeira vez: o link sai quando ele chegar.
  const waiting = rules === undefined && invite.fetchStatus === 'fetching' && !invite.isError;
  const codeMissing = rules === undefined && !waiting;
  const link = describeInviteLink(target, code);

  const share = (): void => {
    // Fechar a folha sem escolher ninguém também resolve; erro do sistema não tem o que mostrar.
    shareInvite(link.url, inviteMessage(target)).catch(() => undefined);
  };

  return (
    <View style={styles.root}>
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('invite.title')}
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
        <Text variant="body" color={colors.textSecondary}>
          {t('invite.subtitle')}
        </Text>
        {mission ? (
          <Animated.View entering={CONTENT_ENTERING}>
            <Text variant="caption" color={colors.textMuted} style={styles.meta}>
              {t('invite.mission', { title: mission.title })}
            </Text>
          </Animated.View>
        ) : null}

        <Card
          accessible={!waiting}
          accessibilityLabel={waiting ? undefined : link.accessibilityLabel}
          testID="invite-link"
          style={styles.block}
        >
          <Text variant="overline" color={colors.textMuted}>
            {t('invite.link')}
          </Text>
          <View style={styles.linkBody}>
            {waiting ? (
              <LinkSkeleton />
            ) : (
              <Animated.View entering={CONTENT_ENTERING}>
                <Text variant="label" selectable>
                  {link.display}
                </Text>
                <Text variant="caption" color={colors.textSecondary} style={styles.meta}>
                  {link.targetText}
                </Text>
              </Animated.View>
            )}
          </View>
        </Card>

        {codeMissing ? (
          <View style={styles.notice}>
            <Text variant="caption" color={colors.textSecondary}>
              {t('invite.noCode')}
            </Text>
            <TextLink
              label={t('common.retry')}
              onPress={() => void invite.refetch()}
              disabled={invite.isFetching}
              style={styles.retry}
            />
          </View>
        ) : null}

        {rules ? (
          <Animated.View entering={CONTENT_ENTERING}>
            <SectionLabel spacing="tight">{t('invite.howYouEarn')}</SectionLabel>
            <View style={styles.rules}>
              <RuleRow points={rules.pointsPerVisit} text={t('invite.perVisit')} />
              <RuleRow points={rules.pointsPerSignup} text={t('invite.perSignup')} />
            </View>
          </Animated.View>
        ) : null}

        {/* No fluxo, logo depois das regras: a sheet abre na altura do
            conteúdo (`fitToContents`), com o botão à vista. */}
        <Button
          label={t('invite.share')}
          icon={Share2}
          onPress={share}
          loading={waiting}
          accessibilityHint={t('invite.shareHint')}
          style={styles.action}
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
  // Abaixo do puxador da sheet. O "×" fica colado ao fim do alvo, na mesma
  // coluna do conteúdo.
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
    paddingTop: spacing.sm,
  },
  meta: {
    marginTop: spacing.metaGap,
  },
  block: {
    marginTop: spacing.blockGap,
  },
  linkBody: {
    marginTop: spacing.metaGap,
  },
  notice: {
    marginTop: spacing.md,
  },
  retry: {
    alignSelf: 'flex-start',
  },
  rules: {
    gap: spacing.listGap,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  // As frases das duas linhas começam na mesma coluna, com "+2" e "+10" à esquerda.
  rulePoints: {
    minWidth: RULE_POINTS_WIDTH,
    alignItems: 'flex-start',
  },
  ruleText: {
    flex: 1,
  },
  action: {
    marginTop: spacing.sectionTop,
  },
});
