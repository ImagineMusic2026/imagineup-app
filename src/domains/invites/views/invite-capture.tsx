import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { entryRoute, useSessionGate } from '@/hooks/use-session-gate';
import { useSessionStore } from '@/stores/session';
import { colors } from '@/theme';

import { safeDestination, utmFromParams } from '../deep-link';
import { normalizeInviteCode } from '../link';
import { savePendingInvite } from '../storage';

type CaptureParams = {
  codigo: string;
  destino?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

/**
 * Rota `/convite/[codigo]`, fora dos guards de sessão: guarda o código (já
 * normalizado) com a origem do link (a página e os `utm_*` da campanha) e sai
 * para uma rota que os guards aceitem (login, onboarding ou a página do link).
 * Código fora do formato não é guardado: só segue. Quem manda o convite ao
 * servidor é a sincronização (`useInviteSync`): o claim depois do cadastro, ou
 * a visita quando o link abre o app com uma conta.
 *
 * `dismissTo` e não `<Redirect>`: com o app aberto, ele volta para as abas que
 * já existem em vez de empilhar outra árvore; e rota barrada por
 * `Stack.Protected` seria ignorada em silêncio, deixando a tela em branco.
 *
 * Com uma tela de conta segurando o fã (`authHolds`: cadastro ou entrar no
 * meio, ou o estágio "código recusado" do cadastro), volta para ela: o
 * `entryRoute` mandaria para a abertura e tiraria de baixo a tela que segura,
 * e o cadastro no estágio recebe o código novo no campo.
 */
export function InviteCaptureScreen() {
  const params = useLocalSearchParams<CaptureParams>();
  const { codigo, destino } = params;
  const gate = useSessionGate();

  // Lê a sessão e o destino do momento em que o código terminou de salvar.
  const leave = useEffectEvent(() => {
    if (useSessionStore.getState().authHolds > 0 && router.canGoBack()) {
      router.back();
      return;
    }
    const target = entryRoute(gate, safeDestination(destino) as Href);
    router.dismissTo(target, { withAnchor: true });
  });

  // A origem do momento em que o código chegou (os parâmetros não mudam sem trocar o código).
  const origin = useEffectEvent(() => ({
    path: safeDestination(destino),
    utm: utmFromParams(params),
  }));

  useEffect(() => {
    let active = true;
    const code = normalizeInviteCode(codigo);
    const save = code ? savePendingInvite(code, origin()) : Promise.resolve();
    save
      .catch(() => undefined)
      .finally(() => {
        if (active) leave();
      });
    return () => {
      active = false;
    };
  }, [codigo]);

  return (
    <View style={styles.container}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
