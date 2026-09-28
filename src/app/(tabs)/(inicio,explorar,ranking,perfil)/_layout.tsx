import { Stack } from 'expo-router';

import { colors } from '@/theme';

/**
 * Uma pilha por aba. A pasta com os quatro grupos gera um layout para cada um,
 * e a âncora diz qual tela fica na base da pilha (inclusive quando o app abre
 * direto num link de artista ou de post).
 */
export const unstable_settings = {
  inicio: { anchor: 'index' },
  explorar: { anchor: 'explorar' },
  ranking: { anchor: 'ranking' },
  perfil: { anchor: 'perfil' },
};

export default function TabStackLayout() {
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}
    />
  );
}
