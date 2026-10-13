import { useLocalSearchParams } from 'expo-router';

import { FanProfileScreen, type FanPublicProfile } from '@/domains/profile';
import { useSessionStore } from '@/stores/session';

import { FanModerationActions } from '../components/fan-moderation-actions';

/**
 * O perfil público de outro fã (`/fa/[fanId]`, seções 28 e 29): a tela do
 * `profile`, com o bloco "Segurança" (denunciar e bloquear, que moram nos
 * posts) no encaixe das ações. Domínio de composição, no molde do `home` e do
 * `artist-page`: importa só pelos index, e ninguém o importa. As ações somem no
 * próprio perfil; a tela do `profile` já as tira carregando, no 404 e no erro.
 */
export function FanPageScreen() {
  const { fanId = '' } = useLocalSearchParams<{ fanId: string }>();
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const own = !fanId || fanId === uid;

  const actions = (profile: FanPublicProfile) =>
    profile.uid === uid ? null : <FanModerationActions fanId={fanId} profile={profile} />;

  return <FanProfileScreen actions={own ? undefined : actions} />;
}
