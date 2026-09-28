import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useEffectEvent } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { entryRoute, useSessionGate } from '@/hooks/use-session-gate';
import { colors } from '@/theme';

import { safeDestination } from '../deep-link';
import { savePendingInvite } from '../storage';

/**
 * Rota `/convite/[codigo]`, fora dos guards de sessão: guarda o código e sai
 * para uma rota que os guards aceitem (login, onboarding ou a página do link).
 *
 * `dismissTo` e não `<Redirect>`: com o app aberto, ele volta para as abas que
 * já existem em vez de empilhar outra árvore; e rota barrada por
 * `Stack.Protected` seria ignorada em silêncio, deixando a tela em branco.
 * Voltar ao destino depois do login entra junto com o cadastro (M3).
 */
export function InviteCaptureScreen() {
  const { codigo, destino } = useLocalSearchParams<{ codigo: string; destino?: string }>();
  const gate = useSessionGate();

  // Lê a sessão e o destino do momento em que o código terminou de salvar.
  const leave = useEffectEvent(() => {
    const target = entryRoute(gate, safeDestination(destino) as Href);
    router.dismissTo(target, { withAnchor: true });
  });

  useEffect(() => {
    let active = true;
    const code = typeof codigo === 'string' ? codigo : '';
    const save = code ? savePendingInvite(code) : Promise.resolve();
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
