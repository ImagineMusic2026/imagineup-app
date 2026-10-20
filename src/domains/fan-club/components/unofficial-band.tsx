import { Pill } from '@/components/pill';
import { t } from '@/i18n';

/**
 * A faixa "Fã-clube, não oficial" de toda tela do fã-clube (decisão 4 e
 * 34.11): uma pílula neutra, sem o rosa da ação nem a palavra "oficial"
 * sozinha. Vem antes do nome, para o leitor de tela a ler primeiro.
 */
export function UnofficialBand({ testID }: { testID?: string }) {
  return <Pill label={t('fanClub.unofficial')} tone="neutral" size="xs" caps testID={testID} />;
}
