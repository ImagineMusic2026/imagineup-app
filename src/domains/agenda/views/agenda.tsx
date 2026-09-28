import { BackHeader, LargeTitleHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';

/** 1m. Lista por mês em FlashList com cabeçalhos fixos quando a tela real entrar. */
export function AgendaScreen() {
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <BackHeader />
      <LargeTitleHeader title={t('agenda.title')} />
      <Placeholder designRef="1m" />
    </Screen>
  );
}
