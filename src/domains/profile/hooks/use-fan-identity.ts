import { usePreferencesStore } from '@/stores/preferences';
import { useSessionStore } from '@/stores/session';
import { isVisibleLine } from '@/utils/visible-line';

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

// O limite do nome no perfil, em unidades de UTF-16, como a função de cadastro
// e o `DISPLAY_NAME_MAX` do formulário de cadastro.
const DISPLAY_NAME_MAX = 60;

/**
 * O nome da sessão que o servidor teria gravado no perfil: uma linha visível
 * de até 60 (a mesma regra de `visibleLine()`). O que não passa continua sem
 * nome, como o servidor deixou.
 */
function sessionNameFor(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = name.normalize('NFC').trim();
  return trimmed.length <= DISPLAY_NAME_MAX && isVisibleLine(trimmed) ? trimmed : null;
}

/**
 * Nome e foto do fã para as telas (header da 1b, hero da 1e, card "Você" da
 * 1f). Com o perfil do Firestore, valem os dele. Enquanto ele não chega, ou
 * antes de a função de cadastro criá-lo, ficam os da sessão.
 *
 * O perfil sem nome (`null`) usa o nome da sessão quando ele passa na mesma
 * regra do servidor (`visibleLine()`, até 60): a função de cadastro lê a conta
 * logo que ela nasce e, se o `updateProfile` do cadastro chegar depois dela, o
 * perfil nasce sem o nome que o fã digitou (e com o @ `fa`). Nome que o
 * servidor recusou de verdade também não passa aqui, e fica sem nome.
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
    const sessionName = sessionUser?.uid === uid ? sessionNameFor(sessionUser.displayName) : null;
    return { uid, name: displayName ?? sessionName, photoURL, loading: false };
  }
  return {
    uid: sessionUser?.uid ?? lastSessionUid,
    name: sessionUser?.displayName ?? null,
    photoURL: sessionUser?.photoURL ?? null,
    // Respondeu sem perfil ou falhou: quem mostra cai no nome de reserva.
    loading: profile.isPending,
  };
}
