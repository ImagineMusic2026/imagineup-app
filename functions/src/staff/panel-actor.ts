import type {
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/https';

import { isActiveMember, sectionAccess, type SectionId } from './model';
import type { CallerAuth, StaffMember } from './service';

// Quem chama uma callable do painel, lido de staff/{uid} a cada chamada, para
// uma seção qualquer: o `readActor` das funções de artistas, generalizado. As
// callables do bloco 6 (posts, shows e moderação) usam este; o dos artistas
// fica como está (migrar depois, sem pressa). docs/arquitetura-api.md, 21.2.

/** Quem fez a mudança, para a auditoria. */
export type PanelActor = { uid: string; name: string };

/** O que a chamada precisa na seção: ver ou alterar. */
export type PanelNeed = 'view' | 'edit';

/** Lê um documento fora (`directRead`) ou dentro (`transactionRead`) de uma transação. */
export type PanelReader = (ref: DocumentReference) => Promise<DocumentSnapshot>;

export const directRead: PanelReader = (ref) => ref.get();

export const transactionRead =
  (tx: Transaction): PanelReader =>
  (ref) =>
    tx.get(ref);

/** Nome de cada seção nas mensagens de acesso. */
const SECTION_LABELS: Partial<Record<SectionId, string>> = {
  artists: 'Artistas e centrais',
  moderation: 'Moderação',
  fans: 'Fãs',
};

/** Motivos de recusa de acesso, iguais aos das funções de artistas. */
export type PanelAccessReason = 'unauthenticated' | 'not-staff' | 'no-section';

export function panelAccessError(reason: PanelAccessReason, section?: SectionId): HttpsError {
  if (reason === 'unauthenticated') {
    return new HttpsError('unauthenticated', 'Entre na sua conta para continuar.', { reason });
  }
  if (reason === 'not-staff') {
    return new HttpsError('permission-denied', 'Só a equipe ativa do painel pode fazer isso.', {
      reason,
    });
  }
  const label = section ? SECTION_LABELS[section] : undefined;
  return new HttpsError(
    'permission-denied',
    label
      ? `Seu acesso ao painel não permite fazer isso em ${label}.`
      : 'Seu acesso ao painel não permite fazer isso.',
    { reason },
  );
}

const nameOf = (member: StaffMember) =>
  typeof member.displayName === 'string' ? member.displayName : '';

/**
 * Quem chamou, lido de staff/{uid}: fora da equipe ativa (ou sessão de antes
 * do `authValidAfter`) é `not-staff`; sem a seção, ou só com leitura para uma
 * mudança, é `no-section` (admin altera tudo, editor altera as liberadas, o
 * leitor só vê). Nas mudanças, a callable chama de novo dentro da transação:
 * quem perde o acesso no meio não grava.
 */
export async function readPanelActor(
  read: PanelReader,
  db: Firestore,
  caller: CallerAuth | undefined,
  section: SectionId,
  need: PanelNeed,
): Promise<PanelActor> {
  if (!caller) throw panelAccessError('unauthenticated');
  const member = (await read(db.collection('staff').doc(caller.uid))).data() as
    StaffMember | undefined;
  const authTime = caller.token.auth_time;
  if (!member || !isActiveMember(member, authTime)) throw panelAccessError('not-staff');
  const access = sectionAccess(member, section, authTime);
  if (access === 'none' || (need === 'edit' && access !== 'edit')) {
    throw panelAccessError('no-section', section);
  }
  return { uid: caller.uid, name: nameOf(member) };
}
