import { router } from 'expo-router';
import {
  StyleSheet,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Button } from '@/components/button';
import { t } from '@/i18n';
import { isLargeText, spacing } from '@/theme';

/**
 * Os botões do topo da 1e, lado a lado, como "Editar perfil" e "Compartilhar
 * perfil" no perfil do Instagram: "Editar perfil" abre a edição na pilha raiz
 * (seção 28) e "Convidar amigos" abre o "Gerar meu link" (`/convidar`), o
 * mesmo do atalho do "+". Não existe link de perfil para compartilhar.
 *
 * Com a fonte padrão, os dois têm a mesma largura. Com a fonte grande, na
 * metade da largura o "Convidar amigos" quebraria (em 1,3, por menos de 1
 * pt): cada botão parte da largura do rótulo, e a sobra se divide entre os
 * dois. Quando nem assim cabem (a fonte em 2,0), o segundo desce para a linha
 * de baixo, sem quebrar o rótulo.
 */
export function ProfileActions({
  style,
  testID,
}: {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { fontScale } = useWindowDimensions();
  const button = isLargeText(fontScale) ? styles.fitLabel : styles.sameWidth;

  return (
    <View testID={testID} style={[styles.row, style]}>
      <Button
        label={t('profile.actions.edit')}
        accessibilityHint={t('profile.actions.editHint')}
        variant="secondary"
        size="mdCompact"
        onPress={() => router.push('/editar-perfil')}
        testID="profile-edit"
        style={button}
      />
      <Button
        label={t('profile.actions.invite')}
        accessibilityHint={t('profile.actions.inviteHint')}
        variant="secondary"
        size="mdCompact"
        onPress={() => router.push('/convidar')}
        testID="profile-invite"
        style={button}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing.sm,
    rowGap: spacing.xs,
  },
  sameWidth: {
    flex: 1,
  },
  fitLabel: {
    flexGrow: 1,
  },
});
