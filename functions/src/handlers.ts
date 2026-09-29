import type { Firestore } from 'firebase-admin/firestore';

import { createProfile, deleteUserData } from './store';

/** Busca a conta no Auth agora; null se ela não existe mais. */
export type FindUser = (uid: string) => Promise<{ displayName?: string | null } | null>;

export type UserCreatedResult =
  { status: 'created'; username: string } | { status: 'exists' } | { status: 'undone' };

/**
 * Conta nova: cria o perfil. A entrega é "pelo menos uma vez" e fora de ordem
 * com a da exclusão, então a conta é conferida antes e depois de gravar. Se a
 * exclusão vier depois da segunda conferência, o deleteUserProfile já enxerga o
 * perfil; se vier antes, a limpeza fica aqui.
 */
export async function handleUserCreated(
  db: Firestore,
  findUser: FindUser,
  event: { uid: string; displayName?: string | null },
): Promise<UserCreatedResult> {
  const user = await findUser(event.uid);
  if (user) {
    // O registro de agora, não o do evento: o SDK cria a conta sem nome, e o
    // app grava o nome (updateProfile) logo em seguida.
    const displayName = user.displayName ?? event.displayName;
    const result = await createProfile(db, { uid: event.uid, displayName });
    if (await findUser(event.uid)) return result;
  }
  // Conta excluída: desfaz o que esta entrega, ou uma anterior, possa ter gravado.
  await deleteUserData(db, event.uid);
  return { status: 'undone' };
}
