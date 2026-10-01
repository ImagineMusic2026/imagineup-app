import type { Firestore } from 'firebase-admin/firestore';
import { setTimeout as delay } from 'node:timers/promises';

import { profileDisplayName } from './profile';
import { createProfile, deleteUserData, isStaffAccount, profileExists } from './store';

/** Busca a conta no Auth agora; null se ela não existe mais. */
export type FindUser = (uid: string) => Promise<{ displayName?: string | null } | null>;

/** Espera entre duas leituras da conta; os testes trocam por uma que não espera. */
export type Sleep = (ms: number) => Promise<void>;

const sleepFor: Sleep = async (ms) => {
  await delay(ms);
};

/**
 * Esperas antes de cada nova leitura da conta sem nome: 250 ms, 0,5 s, 1 s e
 * 2 s, 3,75 s ao todo. O app cria a conta e manda o nome (`updateProfile`) logo
 * em seguida, uma ida e volta do celular, e a espera cobre até um 3G lento.
 * Não vai além porque conta sem nome de verdade (Apple sem nome, conta criada
 * pelo servidor) espera tudo isso pelo perfil, e o app segura o cadastro até o
 * perfil nascer (`PROFILE_WAIT_MS`, 20 s, em `src/domains/auth/consts.ts`).
 * Fica longe do prazo do gatilho (60 s). O nome que chegar depois disso o
 * próprio app tenta gravar no perfil, uma vez, no cadastro, sem mudar o @.
 */
export const NAME_WAIT_MS: readonly number[] = [250, 500, 1000, 2000];

export type UserCreatedResult =
  | { status: 'created'; username: string }
  | { status: 'exists' }
  | { status: 'undone' }
  | { status: 'staff' };

/**
 * Conta nova: cria o perfil. A entrega é "pelo menos uma vez" e fora de ordem
 * com a da exclusão, então a conta é conferida antes e depois de gravar. Se a
 * exclusão vier depois da segunda conferência, o deleteUserProfile já enxerga o
 * perfil; se vier antes, a limpeza fica aqui.
 *
 * Conta da equipe do painel não ganha perfil de fã nem @: o aceite do convite
 * grava staff/{uid} (pending) antes de criar a conta, então a marca sempre
 * chega antes deste gatilho. Qualquer status conta. Conta de fã ligada à
 * equipe (accountCreatedByInvite: false) ganha o perfil normalmente.
 *
 * Conta sem nome espera o nome (NAME_WAIT_MS) antes de gravar, qualquer que
 * seja o provedor, porque o nome e o @ saem desta leitura. O SDK JS cria a
 * conta por e-mail sem nome; a entrada com a Apple pelo SDK JS também (a
 * credencial não leva o nome, que o app vai gravar depois, como no cadastro),
 * e uma espera só para "password" teria de ser lembrada quando ela entrar. Quem
 * já chega com nome (Google) não espera. A espera para quando o nome chega ou a
 * conta some, e entrega repetida, com o perfil já criado, não espera.
 */
export async function handleUserCreated(
  db: Firestore,
  findUser: FindUser,
  event: { uid: string; displayName?: string | null },
  sleep: Sleep = sleepFor,
): Promise<UserCreatedResult> {
  if (await isStaffAccount(db, event.uid)) return { status: 'staff' };
  // O registro de agora, não o do evento: o SDK cria a conta sem nome, e o
  // app grava o nome (updateProfile) logo em seguida.
  const nameOf = (user: { displayName?: string | null }) => user.displayName ?? event.displayName;
  const hasName = (user: { displayName?: string | null }) =>
    profileDisplayName(nameOf(user)) !== null;

  let user = await findUser(event.uid);
  if (user && !hasName(user) && !(await profileExists(db, event.uid))) {
    for (const ms of NAME_WAIT_MS) {
      await sleep(ms);
      user = await findUser(event.uid);
      if (!user || hasName(user)) break;
    }
  }
  if (user) {
    const result = await createProfile(db, { uid: event.uid, displayName: nameOf(user) });
    if (await findUser(event.uid)) return result;
  }
  // Conta excluída: desfaz o que esta entrega, ou uma anterior, possa ter gravado.
  await deleteUserData(db, event.uid);
  return { status: 'undone' };
}
