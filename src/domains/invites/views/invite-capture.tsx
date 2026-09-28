import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { colors } from '@/theme';

import { safeDestination } from '../deep-link';
import { savePendingInvite } from '../storage';

/**
 * Rota `/convite/[codigo]`, fora dos guards de sessão: guarda o código e segue
 * para a página que o link abria (ou o início). Sem sessão, o guard do layout
 * raiz leva ao login. Voltar ao destino depois do login entra junto com o
 * cadastro (M3).
 */
export function InviteCaptureScreen() {
  const { codigo, destino } = useLocalSearchParams<{ codigo: string; destino?: string }>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const code = typeof codigo === 'string' ? codigo : '';
    const save = code ? savePendingInvite(code) : Promise.resolve();
    save.catch(() => undefined).finally(() => setSaved(true));
  }, [codigo]);

  if (saved) return <Redirect href={safeDestination(destino) as Href} />;

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
