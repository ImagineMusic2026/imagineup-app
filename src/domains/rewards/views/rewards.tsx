import { BackHeader, LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';

/** 1h. Resgatar gasta saldo, que é separado do XP de nível (o nível não cai). */
export function RewardsScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <BackHeader />
      <LargeTitleHeader title={t('rewards.title')} />
      <Placeholder designRef="1h" />
    </Screen>
  );
}
