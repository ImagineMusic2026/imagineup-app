import type { StyleProp, TextStyle } from 'react-native';

import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors } from '@/theme';

export interface ExampleNoticeProps {
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * "Ranking de exemplo: as posições de verdade chegam com o ranking do
 * servidor." Aparece quando a primeira página do ranking vem marcada
 * (`LeaderboardPage.example`): com as centrais ou a carteira já no servidor,
 * posição de exemplo nunca fica ao lado de número de verdade sem aviso. Na 1f,
 * abaixo da linha da temporada; na 1d, abaixo do título dos top fãs e da linha
 * da temporada da aba Ranking. As builds de hoje, tudo nas fixtures, não
 * mostram; o bloco 8 apaga.
 */
export function ExampleNotice({ style, testID = 'ranking-example-notice' }: ExampleNoticeProps) {
  return (
    <Text variant="labelSmall" color={colors.textMuted} style={style} testID={testID}>
      {t('ranking.exampleNotice')}
    </Text>
  );
}
