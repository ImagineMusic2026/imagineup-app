import { useLocalSearchParams } from 'expo-router';

import { BackHeader } from '@/components/header';
import { Placeholder } from '@/components/placeholder';
import { Screen } from '@/components/screen';
import { useTabBarInset } from '@/hooks/use-tab-bar-inset';
import { t } from '@/i18n';

/** Detalhe do post com comentários. Não foi desenhado no protótipo. */
export function PostDetailsScreen() {
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const bottomInset = useTabBarInset();

  return (
    <Screen scroll bottomInset={bottomInset}>
      <BackHeader title={t('post.title')} />
      <Placeholder designRef={`post ${postId ?? ''}`.trim()} />
    </Screen>
  );
}
