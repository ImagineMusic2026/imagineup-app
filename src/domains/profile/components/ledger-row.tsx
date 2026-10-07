import type { StyleProp, ViewStyle } from 'react-native';

import { IconTile } from '@/components/icon-tile';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { t } from '@/i18n';
import { colors } from '@/theme';

import {
  isLedgerGain,
  ledgerMeta,
  ledgerRowLabel,
  ledgerSource,
  ledgerValueText,
} from '../describe-ledger';
import type { LedgerEntry } from '../types';

export interface LedgerRowProps {
  entry: LedgerEntry;
  /** Relógio do "Hoje às 22:31" do rótulo. */
  now: Date;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Uma linha do extrato (tela provisória, sem desenho, no visual da 1g): o
 * quadro com o ícone e o tom da origem, o título pela origem, o contexto e a
 * hora embaixo e o valor à direita, em lima no ganho. Não é tocável: um
 * elemento só para o leitor de tela, com tudo.
 */
export function LedgerRow({ entry, now, style, testID }: LedgerRowProps) {
  const source = ledgerSource(entry);
  return (
    <ListRow
      title={t(source.title)}
      meta={ledgerMeta(entry)}
      leading={<IconTile icon={source.icon} tone={source.tone} />}
      trailing={
        <Text variant="chip" color={isLedgerGain(entry) ? colors.points : colors.text} tabular>
          {ledgerValueText(entry)}
        </Text>
      }
      accessibilityLabel={ledgerRowLabel(entry, now)}
      style={style}
      testID={testID}
    />
  );
}
