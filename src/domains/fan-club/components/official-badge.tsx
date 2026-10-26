import { ShieldCheckIcon } from 'phosphor-react-native/src/icons/ShieldCheck';
import { View } from 'react-native';

import { colors } from '@/theme';

/**
 * 14 ao lado do nome nas linhas e cartões, 16 na sheet das regras, 20 no
 * cabeçalho do "Meu fã-clube" e 22 no título da página do fã-clube.
 */
export type OfficialBadgeSize = 14 | 16 | 20 | 22;

/**
 * O selo do fã-clube oficializado pela equipe (34.23): o escudo com o check,
 * branco, ao lado do nome. Diferente da roseta rosa do artista verificado
 * (`VerifiedBadge`) na forma e na cor, para o fã não confundir o fã-clube com
 * o artista; o branco fica fora das cores com papel (rosa ação, lima pontos,
 * ciano shows). Decorativo: o "fã-clube oficial" entra no rótulo de quem
 * mostra o nome.
 */
export function OfficialBadge({
  size = 14,
  testID,
}: {
  size?: OfficialBadgeSize;
  testID?: string;
}) {
  // O ícone do Phosphor não aceita as props de acessibilidade: a View de fora o esconde.
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID={testID ?? 'fan-club-official-badge'}
    >
      <ShieldCheckIcon size={size} color={colors.text} weight="fill" />
    </View>
  );
}
