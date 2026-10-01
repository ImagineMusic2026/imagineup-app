import { StyleSheet, View } from 'react-native';

import { ChipGroup, type ChipItem } from '@/components/chip';
import { t } from '@/i18n';
import { colors } from '@/theme';

import type { AgendaChip } from '../group-by-month';

export { CHIP_HEIGHT, CHIP_SLACK } from '@/components/chip';

export interface MonthChipsProps {
  chips: readonly AgendaChip[];
  /** O mês em vista. */
  value: string;
  /** Tocar num mês (inclusive no escolhido, que volta ao começo dele). */
  onSelect: (month: string) => void;
  /**
   * Fora do leitor de tela: a cópia da lista que rolou para cima enquanto a
   * cópia grudada no topo está à vista, para os meses não serem lidos duas vezes.
   */
  hidden?: boolean;
  testID?: string;
}

/**
 * Chips dos meses da agenda (1m). Tocar rola a lista até o mês (o escolhido
 * também: ele segue a rolagem, e o toque volta ao começo do mês), e rolar a
 * lista troca o escolhido (proposta padrão; a alternativa era o chip filtrar).
 * A fileira gruda no topo quando o título sai da tela, com o fundo da página
 * por baixo, e vai de ponta a ponta, rolando na horizontal com muitos meses.
 * O "Perto de mim" do protótipo está fora do contrato.
 */
export function MonthChips({ chips, value, onSelect, hidden = false, testID }: MonthChipsProps) {
  const items: ChipItem<string>[] = chips.map((chip) => ({
    value: chip.key,
    label: chip.label,
    accessibilityHint: t('agenda.a11y.monthHint', { month: chip.label.toLowerCase() }),
  }));

  return (
    <View
      accessibilityElementsHidden={hidden}
      importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      testID={testID}
      style={styles.row}
    >
      <ChipGroup items={items} value={value} onChange={onSelect} onReselect={onSelect} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: colors.background,
  },
});
