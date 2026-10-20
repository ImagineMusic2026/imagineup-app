import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/button';
import { ChipGroup, type ChipItem } from '@/components/chip';
import { BackButton } from '@/components/header';
import { SheetGrabber } from '@/components/sheet-grabber';
import { Text } from '@/components/text';
import { useCachedFanClubOwner } from '@/domains/fan-club';
import { useReportFanMutation, type CommentReportReason } from '@/domains/posts';
import { SuspensionContact, useCachedFanProfile } from '@/domains/profile';
import { useIsOnline } from '@/hooks/use-is-online';
import { useStayOnScreen } from '@/hooks/use-stay-on-screen';
import { t, type TranslationKey } from '@/i18n';
import { actionRefusal } from '@/services/api/refusal';
import { haptics } from '@/services/haptics';
import { colors, spacing } from '@/theme';

import { fanNameOf } from '../fan-name';

/** Aberta a frio (link), sem tela embaixo, a sheet volta para o início. */
function closeSheet(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

type ReasonChoice = CommentReportReason | 'none';

const REASONS: readonly ReasonChoice[] = ['none', 'spam', 'offensive', 'harassment', 'other'];

// Os motivos de hoje, os mesmos da denúncia de comentário ("Sem motivo" manda null).
const REASON_ITEMS: readonly ChipItem<ReasonChoice>[] = REASONS.map((value) => ({
  value,
  label: t(`post.moderation.reasons.${value}`),
}));

/** O pedido que falhou por último, com o link "Escrever para a equipe" na conta suspensa. */
type Failure = { key: TranslationKey; contact: boolean } | null;

/**
 * Sheet "Denunciar perfil" (`/denunciar-perfil/[fanId]`, seção 29, frente A),
 * aberta pelo bloco "Segurança" do perfil público e pelo "Bloquear e
 * denunciar", no visual da "Opções do comentário": o título com o nome e o
 * "×", o que a equipe analisa, os motivos numa fileira de escolha única ("Sem
 * motivo" manda null) e "Enviar denúncia". O perfil vem do cache do perfil
 * público, lido na abertura (o conteúdo fica fixo, para a altura da sheet não
 * mudar); aberta a frio, sem ele, a sheet fecha. O "Bloquear e denunciar" da
 * página do fã-clube (seção 34, decisão 19) manda o `clube`: sem o perfil no
 * cache, o nome do gestor vem da página em cache, só se o gestor dela for o
 * mesmo fã.
 *
 * Não é otimista: o botão fica "carregando" até o servidor responder,
 * desligado sem internet e enquanto vai, e o voltar fica preso
 * (`useStayOnScreen`). Sucesso (os dois status, `reported` e
 * `already_reported`, com a mesma frase): fecha e anuncia, com o toque de
 * sucesso. Erro: fica, com o aviso acima do botão, anunciado, e o toque de
 * erro, na frase do `actionRefusal` (a conta suspensa com o link "Escrever
 * para a equipe", o teto, o ritmo, o 404 ou a genérica). A resposta que chega
 * com a sheet fechada só anuncia.
 */
export function ReportFanSheetScreen() {
  const params = useLocalSearchParams<{ fanId: string; clube?: string }>();
  const fanId = typeof params.fanId === 'string' ? params.fanId : '';
  const cachedProfile = useCachedFanProfile(fanId);
  const owner = useCachedFanClubOwner(typeof params.clube === 'string' ? params.clube : '', fanId);
  const profile =
    cachedProfile ?? (owner ? { displayName: owner.name, username: owner.username } : undefined);
  const insets = useSafeAreaInsets();
  const online = useIsOnline();
  const [standalone] = useState(() => !router.canGoBack());
  const [reason, setReason] = useState<ReasonChoice>('none');
  const [failure, setFailure] = useState<Failure>(null);
  const name = profile ? fanNameOf(profile) : '';

  const report = useReportFanMutation(fanId, {
    onDone: () => {
      haptics.trigger('success');
      closeSheet();
      AccessibilityInfo.announceForAccessibility(t('fanPage.reportSheet.sent'));
    },
    onError: (error) => {
      const refusal = actionRefusal(error, 'reportFan');
      setFailure({ key: refusal.key, contact: refusal.type === 'suspended' });
      haptics.trigger('error');
      AccessibilityInfo.announceForAccessibility(t(refusal.key));
    },
  });
  useStayOnScreen(report.isPending);

  // Aberta a frio (sem o perfil no cache): não há o que mostrar.
  const missing = !profile;
  useEffect(() => {
    if (missing) closeSheet();
  }, [missing]);

  if (!profile) return null;

  return (
    <View style={styles.root}>
      {standalone ? null : <SheetGrabber />}
      <View style={[styles.header, standalone && { paddingTop: insets.top + spacing.xs }]}>
        <Text variant="titleHeader" accessibilityRole="header" style={styles.title}>
          {t('fanPage.reportSheet.title', { name })}
        </Text>
        <BackButton variant="close" onPress={closeSheet} disabled={report.isPending} />
      </View>
      <View style={[styles.body, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <Text variant="body" color={colors.textSecondary}>
          {t('fanPage.reportSheet.body')}
        </Text>
        <ChipGroup
          items={REASON_ITEMS}
          value={reason}
          onChange={setReason}
          style={styles.reasons}
          testID="fan-report-reasons"
        />
        <View style={styles.actions}>
          {failure ? (
            <View>
              <Text variant="caption" color={colors.danger} style={styles.error}>
                {t(failure.key)}
              </Text>
              {failure.contact ? <SuspensionContact align="center" /> : null}
            </View>
          ) : null}
          <Button
            label={t('fanPage.reportSheet.submit')}
            onPress={() => {
              setFailure(null);
              report.report(reason === 'none' ? null : reason);
            }}
            loading={report.isPending}
            disabled={!online || report.isPending}
            haptic="confirm"
            testID="fan-report-submit"
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // A sheet tem a altura do conteúdo (`fitToContents`): nada de `flex: 1` na raiz.
  root: {
    backgroundColor: colors.surface,
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
    paddingTop: spacing.lg,
  },
  // A fileira vai de ponta a ponta da sheet e rola por baixo da margem, como
  // as outras fileiras de chips do app (o gutter fica dentro dela).
  reasons: {
    marginTop: spacing.md,
    marginHorizontal: -spacing.gutter,
  },
  actions: {
    marginTop: spacing.sectionTop,
    gap: spacing.listGap,
  },
  error: {
    textAlign: 'center',
  },
});
