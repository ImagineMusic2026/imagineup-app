import { staffError, type StaffErrorReason } from './errors';
import { isVisibleLine } from '../visible-line';

/** Seções do painel, na ordem da lateral. Admin sempre tem todas. */
export const SECTION_IDS = [
  'overview',
  'growth',
  'ranking',
  'fans',
  'artists',
  'missions',
  'rewards',
  'moderation',
  'audit',
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Papéis da equipe: admin gerencia a equipe, editor altera e leitor só vê as seções liberadas. */
export const STAFF_ROLES = ['admin', 'editor', 'viewer'] as const;

export type StaffRole = (typeof STAFF_ROLES)[number];

/** Rótulos dos papéis no painel e no e-mail do convite. */
export const ROLE_LABELS: Record<StaffRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Leitor',
};

export type StaffStatus = 'pending' | 'active' | 'disabled';
export type InviteStatus = 'pending' | 'accepted' | 'canceled';
export type EmailStatus = 'sent' | 'failed' | 'skipped';

/** O convite vale 7 dias a partir da criação ou do último reenvio. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Limite dos nomes, em unidades de UTF-16, como o displayName do fã. */
export const NAME_MAX = 60;

/** Senha nova da equipe: pelo menos 8 caracteres (o Firebase aceitaria 6). */
export const PASSWORD_MIN = 8;

/** Teto da senha, o mesmo da política de senha do Firebase. */
export const PASSWORD_MAX = 4096;

/** Quem assina o convite do primeiro admin, que não tem quem convide. */
export const BOOTSTRAP_INVITER_NAME = 'Equipe ImagineUP';

const EMAIL_MAX = 254;
// Uma arroba, sem espaço, e domínio com ponto. O Auth confere o resto no createUser.
const EMAIL_PATTERN = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/u;
const CONTROL = /\p{C}/u;
// Ids automáticos do Firestore (20 letras e números), com folga.
const INVITE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
// uid do Auth: até 128 caracteres; a barra quebraria o caminho staff/{uid}.
const UID_MAX = 128;

/** Corpo da chamada como objeto; qualquer outra coisa é pedido inválido. */
export function requestFields(data: unknown): Record<string, unknown> {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw staffError('invalid-request');
  }
  return data as Record<string, unknown>;
}

/** E-mail minúsculo e sem espaço nas pontas, no formato de e-mail. */
export function parseEmail(value: unknown): string {
  if (typeof value !== 'string') throw staffError('invalid-email');
  const email = value.trim().toLowerCase();
  if (email.length > EMAIL_MAX || CONTROL.test(email) || !EMAIL_PATTERN.test(email)) {
    throw staffError('invalid-email');
  }
  return email;
}

/**
 * Nome no painel: NFC, sem espaço nas pontas, 1 a 60 unidades de UTF-16 e uma
 * linha visível (a mesma regra do nome do fã no firestore.rules).
 */
export function parseName(value: unknown): string {
  if (typeof value !== 'string') throw staffError('invalid-name');
  const name = value.normalize('NFC').trim();
  if (name.length < 1 || name.length > NAME_MAX || !isVisibleLine(name)) {
    throw staffError('invalid-name');
  }
  return name;
}

/** Nome sugerido pelo admin: opcional; vazio vira null. */
export function parseOptionalName(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return parseName(value);
}

/** Senha nova: de 8 a 4096 caracteres. Não é aparada: espaço também conta. */
export function parsePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length < PASSWORD_MIN) throw staffError('weak-password');
  if (value.length > PASSWORD_MAX) throw staffError('invalid-password');
  return value;
}

/** Papel da equipe mandado pelo painel: admin, editor ou viewer. */
export function parseRole(value: unknown): StaffRole {
  if (typeof value !== 'string' || !(STAFF_ROLES as readonly string[]).includes(value)) {
    throw staffError('invalid-role');
  }
  return value as StaffRole;
}

/** Lista de seções sem repetição e só com ids conhecidos, na ordem da lateral. */
export function parseSections(value: unknown): SectionId[] {
  if (!Array.isArray(value)) throw staffError('invalid-sections');
  const seen = new Set<string>();
  for (const section of value) {
    if (typeof section !== 'string' || !(SECTION_IDS as readonly string[]).includes(section)) {
      throw staffError('invalid-sections');
    }
    if (seen.has(section)) throw staffError('invalid-sections');
    seen.add(section);
  }
  return SECTION_IDS.filter((section) => seen.has(section));
}

/**
 * Papel e seções que vão para o banco. Admin grava sempre a lista completa
 * (as seções mandadas só precisam ser válidas); editor e leitor precisam de
 * pelo menos uma.
 */
export function accessFor(
  role: StaffRole,
  sections: readonly SectionId[] | undefined,
): { role: StaffRole; sections: SectionId[] } {
  if (role === 'admin') return { role, sections: [...SECTION_IDS] };
  const chosen = SECTION_IDS.filter((section) => sections?.includes(section));
  if (chosen.length === 0) throw staffError('invalid-sections');
  return { role, sections: chosen };
}

/** Papel e seções do pedido de convite (seções podem faltar só para admin). */
export function parseAccess(
  roleValue: unknown,
  sectionsValue: unknown,
): { role: StaffRole; sections: SectionId[] } {
  const role = parseRole(roleValue);
  const sections =
    role === 'admin' && sectionsValue === undefined ? undefined : parseSections(sectionsValue);
  return accessFor(role, sections);
}

/** Id de convite vindo do link. Fora do formato, a resposta é a de convite inválido. */
export function parseInviteId(value: unknown, reason: StaffErrorReason = 'invalid'): string {
  if (typeof value !== 'string' || !INVITE_ID_PATTERN.test(value)) throw staffError(reason);
  return value;
}

/** uid de um membro da equipe mandado pelo painel. */
export function parseUid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > UID_MAX ||
    value.includes('/') ||
    value === '.' ||
    value === '..' ||
    /^__.*__$/.test(value)
  ) {
    throw staffError('invalid-request');
  }
  return value;
}

/** Validade de um convite criado ou reenviado agora. */
export function inviteExpiry(nowMs: number): number {
  return nowMs + INVITE_TTL_MS;
}

export type InviteState = 'pending' | 'accepted' | 'canceled' | 'expired';

/** Estado do convite agora. Vencido é calculado: no banco ele continua pending. */
export function inviteState(
  invite: { status: InviteStatus; expiresAt: { toMillis(): number } },
  nowMs: number,
): InviteState {
  if (invite.status !== 'pending') return invite.status;
  return invite.expiresAt.toMillis() <= nowMs ? 'expired' : 'pending';
}

/** Admin com acesso: doc com status active e papel admin. */
export function isActiveAdmin(member: { status?: unknown; role?: unknown } | undefined): boolean {
  return member?.status === 'active' && member.role === 'admin';
}

/**
 * true se a sessão pode usar o acesso do membro: o login dela (auth_time, em
 * segundos) é igual ou posterior a `authValidAfter`, que o linkStaffInvite
 * grava ao ligar uma conta que já existia. Sem o campo, qualquer sessão vale.
 * Mesma conta de isActiveStaff() no firestore.rules.
 */
export function sessionAllowed(member: { authValidAfter?: unknown }, authTime: unknown): boolean {
  const after = typeof member.authValidAfter === 'number' ? member.authValidAfter : 0;
  const time = typeof authTime === 'number' ? authTime : 0;
  return time >= after;
}

/** Campos de staff/{uid} que decidem o acesso a uma seção. */
export type MemberAccessFields = {
  status?: unknown;
  role?: unknown;
  sections?: unknown;
  authValidAfter?: unknown;
};

/**
 * true se o membro usa o painel nesta sessão: status active e login a partir
 * de authValidAfter. Mesma conta de isActiveStaff() no firestore.rules.
 */
export function isActiveMember(member: MemberAccessFields | undefined, authTime: unknown): boolean {
  return member?.status === 'active' && sessionAllowed(member, authTime);
}

/** O que um membro faz numa seção: nada, só ver ou alterar. */
export type SectionAccess = 'none' | 'view' | 'edit';

/**
 * Acesso do membro a uma seção nesta sessão. Espelho de canSeeSection (view)
 * e canEditSection (edit) do firestore.rules: admin altera tudo, editor altera
 * as seções liberadas e qualquer outro papel só vê as liberadas.
 */
export function sectionAccess(
  member: MemberAccessFields | undefined,
  section: SectionId,
  authTime: unknown,
): SectionAccess {
  if (!member || !isActiveMember(member, authTime)) return 'none';
  if (member.role === 'admin') return 'edit';
  const sections: unknown[] = Array.isArray(member.sections) ? member.sections : [];
  if (!sections.includes(section)) return 'none';
  return member.role === 'editor' ? 'edit' : 'view';
}

/**
 * true se tirar o acesso de admin de `targetUid` deixa o painel sem nenhum
 * admin ativo. `activeAdminUids` são os admins ativos lidos na mesma transação.
 */
export function leavesNoActiveAdmin(
  activeAdminUids: readonly string[],
  targetUid: string,
): boolean {
  return !activeAdminUids.some((uid) => uid !== targetUid);
}

/**
 * Link do convite. O token vai no fragmento (#), que o navegador nunca manda
 * a servidor nenhum: nem à Vercel, nem a quem registra acessos.
 */
export function inviteUrl(panelUrl: string, inviteId: string, token: string): string {
  return `${panelUrl.replace(/\/+$/, '')}/convite/${encodeURIComponent(inviteId)}#${token}`;
}
