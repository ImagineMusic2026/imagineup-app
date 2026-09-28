import { LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';

/**
 * 1f. Missões (1g) e Resgatar (1h) moram na pilha desta aba, mas o fã chega a
 * elas pelo "+" do meio da tab bar (aprovado em 2026-09-28).
 */
export function RankingScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <LargeTitleHeader title={t('ranking.title')} />
      <Placeholder designRef="1f" />
    </Screen>
  );
}
