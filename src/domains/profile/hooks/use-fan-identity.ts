import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';

import { useMyProfileQuery } from '../queries';

export interface FanIdentity {
  /** Para a cor estável do avatar sem foto. */
  uid: string | null;
  /** `null` quando não há nome: quem mostra decide entre carregando e o nome de reserva. */
  name: string | null;
  photoURL: string | null;
  /** O perfil ainda não chegou: o nome, se houver, é o da sessão. */
  loading: boolean;
}

/**
 * Nome e foto do fã para as telas (header da 1b, hero da 1e, card "Você" da
 * 1f). Com o perfil do Firestore, valem os dele, inclusive o nome `null` que o
 * servidor gravou quando o do cadastro não passou em `visibleLine()`. Enquanto
 * ele não chega, ou antes de a função de cadastro criá-lo, ficam os da sessão.
 *
 * Só conta como carregando enquanto a leitura não respondeu. Perfil que o
 * servidor diz não existir (conta de antes da função de cadastro) não prende a
 * tela num esqueleto sem fim: sem nome na sessão, ela cai no nome de reserva, e
 * a escuta troca pelo nome certo se o perfil nascer depois. O cadastro já
 * espera o perfil nascer antes de liberar o app.
 */
export function useFanIdentity(): FanIdentity {
  const profile = useMyProfileQuery();
  const sessionUser = useSessionStore((state) => state.user);
  const lastSessionUid = usePreferencesStore((state) => state.lastSessionUid);

  if (profile.data) {
    const { uid, displayName, photoURL } = profile.data;
    return { uid, name: displayName, photoURL, loading: false };
  }
  return {
    uid: sessionUser?.uid ?? lastSessionUid,
    name: sessionUser?.displayName ?? null,
    photoURL: sessionUser?.photoURL ?? null,
    // Respondeu sem perfil ou falhou: quem mostra cai no nome de reserva.
    loading: profile.isPending,
  };
}
