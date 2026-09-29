import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { expiresLabel, type InviteEmailParams } from '../src/staff/email';
import { SECTION_IDS } from '../src/staff/model';
import {
  acceptInvite,
  createInvite,
  resendInvite,
  type CallerAuth,
  type StaffAuth,
  type StaffDeps,
} from '../src/staff/service';
import { hashInviteToken } from '../src/staff/token';

/**
 * Equipe do painel nos emuladores: as callables de verdade, chamadas como o
 * painel chama (POST com { data } e o ID token), mais as corridas que só dá
 * para provocar chamando o código com um Auth trocado. Rode com
 * `npm run test:functions`, na raiz do app.
 */
const PROJECT_ID = 'demo-imagine-up-app';
const REGION = 'southamerica-east1';
const app = initializeApp({ projectId: PROJECT_ID });
const auth = getAuth(app);
const db = getFirestore(app);

const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
let functionsOrigin = '';

const STAFF_FUNCTIONS = [
  'createStaffInvite',
  'resendStaffInvite',
  'cancelStaffInvite',
  'getStaffInvite',
  'acceptStaffInvite',
  'linkStaffInvite',
  'updateStaffMember',
  'setStaffMemberActive',
  'removeStaffMember',
];

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

/** EmailJS configurado no emulador: os testes mandariam e-mail de verdade. */
function emulatorSendsEmail(): boolean {
  const values: Record<string, string> = {};
  for (const name of ['.env', `.env.${PROJECT_ID}`, '.env.local']) {
    const file = resolve(__dirname, '..', name);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/.exec(line);
      if (match) values[match[1]!] = match[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return ['EMAILJS_SERVICE_ID', 'EMAILJS_TEMPLATE_ID', 'EMAILJS_PUBLIC_KEY'].every(
    (key) => values[key],
  );
}

beforeAll(async () => {
  if (emulatorSendsEmail()) {
    throw new Error(
      `O EmailJS está configurado em functions/.env.${PROJECT_ID}: estes testes mandariam ` +
        'convites de verdade. Deixe EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID e EMAILJS_PUBLIC_KEY vazios para rodar.',
    );
  }
  const hub = process.env.FIREBASE_EMULATOR_HUB;
  if (!hub) throw new Error('Rode com npm run test:functions.');
  const emulators = (await (await fetch(`http://${hub}/emulators`)).json()) as {
    functions?: { host: string; port: number };
  };
  if (!emulators.functions) throw new Error('O emulador de Functions não está rodando.');
  const { host, port } = emulators.functions;
  functionsOrigin = `http://${host}:${port}`;
  const { backends } = (await (await fetch(`${functionsOrigin}/backends`)).json()) as {
    backends: { functionTriggers: { entryPoint: string }[] }[];
  };
  const loaded = backends.flatMap((backend) => backend.functionTriggers.map((t) => t.entryPoint));
  const missing = ['createUserProfile', 'deleteUserProfile', ...STAFF_FUNCTIONS].filter(
    (name) => !loaded.includes(name),
  );
  if (missing.length > 0) {
    throw new Error(
      `O emulador não carregou ${missing.join(', ')}: procure "Failed to load function definition" no log.`,
    );
  }
});

beforeEach(async () => {
  if (!authHost || !firestoreHost) throw new Error('Rode com npm run test:functions.');
  await fetch(
    `http://${firestoreHost}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await fetch(`http://${authHost}/emulator/v1/projects/${PROJECT_ID}/accounts`, {
    method: 'DELETE',
  });
});

// uids e e-mails únicos na execução inteira: um gatilho atrasado de um teste
// anterior nunca acerta os dados do teste seguinte.
let counter = 0;
const unique = (prefix: string) => `${prefix}${++counter}`;
const newEmail = (prefix = 'equipe') => `${unique(prefix)}@teste.dev`;

async function waitFor<T>(what: string, read: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Tempo esgotado esperando ${what}.`);
    await sleep(200);
  }
}

const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;
const isGone = (path: string) =>
  waitFor(`${path} sumir`, async () => ((await exists(path)) ? undefined : true));
const profileOf = (uid: string) =>
  waitFor(`o perfil de ${uid}`, async () => (await db.doc(`users/${uid}`).get()).data());
const reservationsOf = async (uid: string) =>
  (await db.collection('usernames').where('uid', '==', uid).get()).docs.map((doc) => doc.id);
const membersWithEmail = async (email: string) =>
  (await db.collection('staff').where('email', '==', email).get()).docs;

async function auditOf(action: string, targetEmail: string): Promise<DocumentData[]> {
  const entries = await db.collection('staffAudit').where('action', '==', action).get();
  return entries.docs.map((doc) => doc.data()).filter((entry) => entry.targetEmail === targetEmail);
}

async function accountExists(uid: string): Promise<boolean> {
  try {
    await auth.getUser(uid);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/user-not-found') return false;
    throw error;
  }
}

/** Entra pela API do Auth, como o SDK do painel, e devolve o ID token. */
async function signIn(email: string, password: string): Promise<string> {
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const body = (await response.json()) as { idToken?: string; error?: { message: string } };
  if (!body.idToken) throw new Error(`Não entrou com ${email}: ${body.error?.message}`);
  return body.idToken;
}

type CallError = { status: string; message: string; details?: { reason?: string } };
type CallResponse<T> = { result?: T; error?: CallError };

/** Chama a callable como o SDK do painel: POST { data } com o ID token. */
async function call<T>(name: string, data: unknown, idToken?: string): Promise<CallResponse<T>> {
  const response = await fetch(`${functionsOrigin}/${PROJECT_ID}/${REGION}/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify({ data }),
  });
  return (await response.json()) as CallResponse<T>;
}

async function ok<T = Record<string, unknown>>(
  name: string,
  data: unknown,
  idToken?: string,
): Promise<T> {
  const { result, error } = await call<T>(name, data, idToken);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function fails(name: string, data: unknown, idToken?: string): Promise<CallError> {
  const { error } = await call(name, data, idToken);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error;
}

const reason = (status: string, why: string) => ({ status, details: { reason: why } });

type Member = { uid: string; email: string; password: string; token: string };

/** Claims do ID token (o emulador não assina, mas o formato é o de sempre). */
function claimsOf(idToken: string): CallerAuth['token'] {
  return JSON.parse(Buffer.from(idToken.split('.')[1]!, 'base64url').toString('utf8'));
}

/** request.auth de quem chama, para usar o código das funções direto. */
const callerOf = (member: Member): CallerAuth => ({
  uid: member.uid,
  token: claimsOf(member.token),
});

/**
 * Membro gravado direto, como o aceite deixaria: a marca em staff/{uid} vem
 * antes da conta, então o gatilho de cadastro não cria perfil de fã.
 */
async function seedMember(
  displayName: string,
  role: 'admin' | 'editor' | 'viewer',
  sections: string[] = [],
): Promise<Member> {
  const uid = unique(role);
  const email = newEmail(role);
  const password = 'senha-da-equipe';
  const now = Timestamp.now();
  await db.doc(`staff/${uid}`).set({
    uid,
    email,
    displayName,
    role,
    sections: role === 'admin' ? [...SECTION_IDS] : sections,
    status: 'active',
    accountCreatedByInvite: true,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  await auth.createUser({ uid, email, password, displayName, emailVerified: true });
  return { uid, email, password, token: await signIn(email, password) };
}

/** Fã que se cadastra pelo app (API de cadastro) e ganha o perfil pelo gatilho. */
async function signUpFan(displayName: string): Promise<Member> {
  const email = newEmail('fa');
  const password = 'senha-do-fa-1';
  const response = await fetch(
    `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=chave-falsa`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, displayName, returnSecureToken: true }),
    },
  );
  const { localId, idToken } = (await response.json()) as { localId: string; idToken: string };
  await profileOf(localId);
  return { uid: localId, email, password, token: idToken };
}

type InviteLink = { inviteId: string; inviteUrl: string; expiresAt: string; emailStatus: string };

/** Convite pelo painel; o token só existe no link, depois do #. */
async function invite(
  admin: Member,
  email: string,
  role: 'admin' | 'editor' | 'viewer',
  sections: string[] = [],
  suggestedName?: string,
): Promise<InviteLink & { token: string }> {
  const link = await ok<InviteLink>(
    'createStaffInvite',
    { email, role, sections, suggestedName },
    admin.token,
  );
  return { ...link, token: new URL(link.inviteUrl).hash.slice(1) };
}

/**
 * Espera o gatilho de cadastro das contas criadas até aqui: cria uma conta de
 * fã depois delas e espera o perfil dela, com folga.
 */
async function createTriggersSettled(): Promise<void> {
  const sentinel = await auth.createUser({ email: newEmail('sentinela') });
  await profileOf(sentinel.uid);
  await sleep(1000);
}

const deps = (overrides: Partial<StaffDeps> = {}): StaffDeps => ({
  db,
  auth,
  panelUrl: 'http://localhost:3000',
  sendInviteEmail: async () => 'skipped',
  ...overrides,
});

/** Auth de verdade (emulador), com o createUser trocado para provocar corridas. */
const authWith = (createUser: StaffAuth['createUser']): StaffAuth => ({
  getUser: (uid) => auth.getUser(uid),
  getUserByEmail: (value) => auth.getUserByEmail(value),
  updateUser: (uid, properties) => auth.updateUser(uid, properties),
  deleteUser: (uid) => auth.deleteUser(uid),
  createUser,
});

/**
 * O estado que o aceite deixa se cair entre criar a conta e ativar o membro:
 * marca pendente, acceptingUid no convite e a conta no Auth. Convite de
 * editor com a seção fans.
 */
async function crashedAccept(admin: Member, inviteId: string, email: string): Promise<string> {
  const uid = unique('reservado');
  const now = Timestamp.now();
  await db.doc(`staff/${uid}`).set({
    uid,
    email,
    displayName: 'Nome Antigo',
    role: 'editor',
    sections: ['fans'],
    status: 'pending',
    accountCreatedByInvite: true,
    inviteId,
    invitedBy: admin.uid,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  await db.doc(`staffInvites/${inviteId}`).update({ acceptingUid: uid });
  await auth.createUser({ uid, email, password: 'senha-antiga-1', displayName: 'Nome Antigo' });
  return uid;
}

describe('convite da equipe', () => {
  it('admin cria o convite: o token só existe no link, depois do #', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const link = await ok<InviteLink>(
      'createStaffInvite',
      {
        email: '  Nova.Pessoa@Teste.DEV ',
        suggestedName: 'Nova Pessoa',
        role: 'viewer',
        sections: ['audit', 'fans'],
      },
      admin.token,
    );
    // Sem EmailJS no emulador, o convite sai sem e-mail e o admin copia o link.
    expect(link.emailStatus).toBe('skipped');
    const url = new URL(link.inviteUrl);
    expect(url.pathname).toBe(`/convite/${link.inviteId}`);
    expect(url.search).toBe('');
    const token = url.hash.slice(1);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = (await read(`staffInvites/${link.inviteId}`))!;
    expect(stored).toMatchObject({
      email: 'nova.pessoa@teste.dev',
      suggestedName: 'Nova Pessoa',
      role: 'viewer',
      sections: ['fans', 'audit'],
      tokenHash: hashInviteToken(token),
      status: 'pending',
      invitedBy: admin.uid,
      invitedByName: 'Admin Um',
      lastSentBy: admin.uid,
      sendCount: 1,
      emailStatus: 'skipped',
      acceptingUid: null,
      acceptedUid: null,
      acceptedAt: null,
      canceledAt: null,
      canceledBy: null,
      cancelReason: null,
    });
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.expiresAt.toMillis() - stored.createdAt.toMillis()).toBe(SEVEN_DAYS);
    expect(new Date(link.expiresAt).getTime()).toBe(stored.expiresAt.toMillis());

    expect(await auditOf('invite.created', 'nova.pessoa@teste.dev')).toMatchObject([
      {
        actorUid: admin.uid,
        actorName: 'Admin Um',
        targetUid: null,
        details: { inviteId: link.inviteId, role: 'viewer', sections: ['fans', 'audit'] },
      },
    ]);
  });

  it('e-mail do convite: falha no envio não desfaz o convite; o reenvio grava o novo envio', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const other = await seedMember('Admin Dois', 'admin');
    const email = newEmail();
    const sent: InviteEmailParams[] = [];
    const sender = (status: 'sent' | 'failed') => async (params: InviteEmailParams) => {
      sent.push(params);
      return status;
    };

    const created = await createInvite(
      deps({ sendInviteEmail: sender('failed') }),
      callerOf(admin),
      {
        email,
        role: 'viewer',
        sections: ['fans'],
      },
    );
    expect(created.emailStatus).toBe('failed');
    expect(await read(`staffInvites/${created.inviteId}`)).toMatchObject({
      status: 'pending',
      emailStatus: 'failed',
    });
    // O admin copia o link, que continua valendo.
    const token = new URL(created.inviteUrl).hash.slice(1);
    await ok('getStaffInvite', { inviteId: created.inviteId, token });
    expect(sent).toEqual([
      {
        to_email: email,
        to_name: '',
        inviter_name: 'Admin Um',
        role_label: 'Leitor',
        invite_link: created.inviteUrl,
        expires_label: expiresLabel(new Date(created.expiresAt)),
      },
    ]);
    expect(sent[0]!.invite_link).toContain(`#${token}`);

    // Outro admin reenvia e o envio dá certo: o e-mail sai no nome de quem convidou.
    const resent = await resendInvite(deps({ sendInviteEmail: sender('sent') }), callerOf(other), {
      inviteId: created.inviteId,
    });
    expect(resent.emailStatus).toBe('sent');
    expect(await read(`staffInvites/${created.inviteId}`)).toMatchObject({
      emailStatus: 'sent',
      invitedBy: admin.uid,
      invitedByName: 'Admin Um',
      lastSentBy: other.uid,
    });
    expect(sent[1]).toEqual({
      to_email: email,
      to_name: '',
      inviter_name: 'Admin Um',
      role_label: 'Leitor',
      invite_link: resent.inviteUrl,
      expires_label: expiresLabel(new Date(resent.expiresAt)),
    });
    expect(resent.inviteUrl).not.toBe(created.inviteUrl);
  });

  it('convite de admin leva todas as seções', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const link = await invite(admin, newEmail(), 'admin');
    expect((await read(`staffInvites/${link.inviteId}`))!.sections).toEqual([...SECTION_IDS]);
  });

  it('pedido inválido volta com o motivo', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const base = { email: newEmail(), role: 'editor', sections: ['fans'] };
    for (const [change, why] of [
      [{ email: 'sem-arroba' }, 'invalid-email'],
      [{ role: 'dono' }, 'invalid-role'],
      [{ sections: [] }, 'invalid-sections'],
      [{ sections: ['fans', 'fans'] }, 'invalid-sections'],
      [{ sections: ['playlists'] }, 'invalid-sections'],
      [{ suggestedName: 'ㅤ' }, 'invalid-name'],
    ] as const) {
      expect(await fails('createStaffInvite', { ...base, ...change }, admin.token)).toMatchObject(
        reason('INVALID_ARGUMENT', why),
      );
    }
  });

  it('convidar de novo o mesmo e-mail cancela o convite anterior', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const first = await invite(admin, email, 'viewer', ['fans']);
    const second = await invite(admin, email, 'editor', ['missions']);
    expect(await read(`staffInvites/${first.inviteId}`)).toMatchObject({
      status: 'canceled',
      cancelReason: 'replaced',
      canceledBy: admin.uid,
    });
    expect(
      await fails('getStaffInvite', { inviteId: first.inviteId, token: first.token }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'canceled'));
    expect(await read(`staffInvites/${second.inviteId}`)).toMatchObject({ status: 'pending' });
  });

  it('quem já é da equipe não é convidado de novo; desativado precisa ser reativado', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const editor = await seedMember('Editora', 'editor', ['fans']);
    expect(
      await fails(
        'createStaffInvite',
        { email: editor.email, role: 'viewer', sections: ['fans'] },
        admin.token,
      ),
    ).toMatchObject(reason('ALREADY_EXISTS', 'already-staff'));

    await ok('setStaffMemberActive', { uid: editor.uid, active: false }, admin.token);
    const disabled = await fails(
      'createStaffInvite',
      { email: editor.email, role: 'viewer', sections: ['fans'] },
      admin.token,
    );
    expect(disabled).toMatchObject(reason('FAILED_PRECONDITION', 'member-disabled'));
    expect(disabled.message).toBe('Essa pessoa está desativada. Reative o acesso em Equipe.');
  });
});

describe('página do convite (getStaffInvite)', () => {
  it('mostra o convite a quem tem o link', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'editor', ['missions', 'fans'], 'Bruna');
    expect(await ok('getStaffInvite', { inviteId: link.inviteId, token: link.token })).toEqual({
      email,
      suggestedName: 'Bruna',
      role: 'editor',
      sections: ['fans', 'missions'],
      expiresAt: link.expiresAt,
      invitedByName: 'Admin Um',
      accountExists: false,
    });
  });

  it('id inexistente e token errado dão a mesma resposta', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const link = await invite(admin, newEmail(), 'viewer', ['fans']);
    const wrongToken = await fails('getStaffInvite', {
      inviteId: link.inviteId,
      token: link.token.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')),
    });
    const unknownId = await fails('getStaffInvite', { inviteId: 'naoexiste', token: link.token });
    const noToken = await fails('getStaffInvite', { inviteId: link.inviteId });
    for (const error of [wrongToken, unknownId, noToken]) {
      expect(error).toMatchObject(reason('NOT_FOUND', 'invalid'));
      expect(error.message).toBe(wrongToken.message);
    }
  });

  it('vencido, cancelado e aceito, cada um com o seu motivo', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const expired = await invite(admin, newEmail(), 'viewer', ['fans']);
    await db
      .doc(`staffInvites/${expired.inviteId}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    expect(
      await fails('getStaffInvite', { inviteId: expired.inviteId, token: expired.token }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'expired'));

    const canceled = await invite(admin, newEmail(), 'viewer', ['fans']);
    await ok('cancelStaffInvite', { inviteId: canceled.inviteId }, admin.token);
    expect(
      await fails('getStaffInvite', { inviteId: canceled.inviteId, token: canceled.token }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'canceled'));

    const accepted = await invite(admin, newEmail(), 'viewer', ['fans']);
    await ok('acceptStaffInvite', {
      inviteId: accepted.inviteId,
      token: accepted.token,
      displayName: 'Nova',
      password: 'senha-nova-123',
    });
    expect(
      await fails('getStaffInvite', { inviteId: accepted.inviteId, token: accepted.token }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'accepted'));
  });
});

describe('aceite com conta nova (acceptStaffInvite)', () => {
  it('cria a conta, ativa o membro, e o gatilho não cria perfil de fã', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'editor', ['fans', 'missions']);
    const accept = {
      inviteId: link.inviteId,
      token: link.token,
      displayName: '  Nova Pessoa ',
      password: 'senha-nova-123',
    };
    const { uid, email: acceptedEmail } = await ok<{ uid: string; email: string }>(
      'acceptStaffInvite',
      accept,
    );
    expect(acceptedEmail).toBe(email);

    expect(await auth.getUser(uid)).toMatchObject({
      email,
      emailVerified: true,
      displayName: 'Nova Pessoa',
    });
    expect(await read(`staff/${uid}`)).toMatchObject({
      uid,
      email,
      displayName: 'Nova Pessoa',
      role: 'editor',
      sections: ['fans', 'missions'],
      status: 'active',
      accountCreatedByInvite: true,
      inviteId: link.inviteId,
      invitedBy: admin.uid,
    });
    const accepted = (await read(`staffInvites/${link.inviteId}`))!;
    expect(accepted).toMatchObject({ status: 'accepted', acceptedUid: uid, acceptingUid: uid });
    expect(accepted.acceptedAt).toBeInstanceOf(Timestamp);
    expect(await auditOf('invite.accepted', email)).toMatchObject([
      { actorUid: uid, actorName: 'Nova Pessoa', targetUid: uid },
    ]);
    // O painel entra em seguida com a senha escolhida.
    await signIn(email, 'senha-nova-123');

    await createTriggersSettled();
    expect(await exists(`users/${uid}`)).toBe(false);
    expect(await reservationsOf(uid)).toEqual([]);

    // Repetir depois de aceito não cria nada: o convite já foi usado.
    expect(await fails('acceptStaffInvite', accept)).toMatchObject(
      reason('FAILED_PRECONDITION', 'accepted'),
    );
    expect(await membersWithEmail(email)).toHaveLength(1);
  });

  it('nome e senha inválidos voltam com o motivo, sem reservar nada', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const link = await invite(admin, newEmail(), 'viewer', ['fans']);
    const base = { inviteId: link.inviteId, token: link.token };
    expect(
      await fails('acceptStaffInvite', { ...base, displayName: '', password: 'senha-nova-123' }),
    ).toMatchObject(reason('INVALID_ARGUMENT', 'invalid-name'));
    expect(
      await fails('acceptStaffInvite', { ...base, displayName: 'Nova', password: '1234567' }),
    ).toMatchObject(reason('INVALID_ARGUMENT', 'weak-password'));
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({ acceptingUid: null });
  });

  it('dois aceites ao mesmo tempo dão uma conta e um membro', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'viewer', ['ranking']);
    const accept = {
      inviteId: link.inviteId,
      token: link.token,
      displayName: 'Nova',
      password: 'senha-nova-123',
    };
    const responses = await Promise.all([
      call<{ uid: string }>('acceptStaffInvite', accept),
      call<{ uid: string }>('acceptStaffInvite', accept),
    ]);
    const uids = responses.flatMap((response) => (response.result ? [response.result.uid] : []));
    expect(uids.length).toBeGreaterThan(0);
    for (const response of responses) {
      if (response.error) expect(response.error.details?.reason).toBe('accepted');
    }
    expect(new Set(uids).size).toBe(1);
    expect((await auth.getUserByEmail(email)).uid).toBe(uids[0]);
    const members = await membersWithEmail(email);
    expect(members.map((doc) => [doc.id, doc.get('status')])).toEqual([[uids[0], 'active']]);
    await signIn(email, 'senha-nova-123');
  });

  it('aceite que parou no meio (conta criada, convite pendente) termina na nova tentativa', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'editor', ['fans']);
    const uid = await crashedAccept(admin, link.inviteId, email);

    // A página segue pelo aceite (conta nova), não pelo login.
    expect(
      await ok<{ accountExists: boolean }>('getStaffInvite', {
        inviteId: link.inviteId,
        token: link.token,
      }),
    ).toMatchObject({ accountExists: false });

    const result = await ok<{ uid: string }>('acceptStaffInvite', {
      inviteId: link.inviteId,
      token: link.token,
      displayName: 'Nome Novo',
      password: 'senha-nova-123',
    });
    expect(result.uid).toBe(uid);
    expect(await read(`staff/${uid}`)).toMatchObject({
      status: 'active',
      displayName: 'Nome Novo',
      accountCreatedByInvite: true,
    });
    // Vale a senha desta tentativa.
    await signIn(email, 'senha-nova-123');
    await expect(signIn(email, 'senha-antiga-1')).rejects.toThrow();
    await createTriggersSettled();
    expect(await exists(`users/${uid}`)).toBe(false);
  });

  it('e-mail que já tem conta: account-exists, sem marca nem reserva', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    const link = await invite(admin, fan.email, 'viewer', ['fans']);
    expect(
      await ok<{ accountExists: boolean }>('getStaffInvite', {
        inviteId: link.inviteId,
        token: link.token,
      }),
    ).toMatchObject({ accountExists: true });
    expect(
      await fails('acceptStaffInvite', {
        inviteId: link.inviteId,
        token: link.token,
        displayName: 'Camila',
        password: 'senha-nova-123',
      }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'account-exists'));
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      acceptingUid: null,
    });
    expect(await membersWithEmail(fan.email)).toHaveLength(0);
  });

  it('conta criada com o e-mail no meio do aceite: account-exists, e a reserva sai', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'viewer', ['fans']);
    let squatter = '';
    // Alguém se cadastra com o mesmo e-mail logo antes de a função criar a conta.
    const racingAuth = authWith(async (properties) => {
      squatter = (await auth.createUser({ email, password: 'outra-senha-1' })).uid;
      return auth.createUser(properties);
    });
    await expect(
      acceptInvite(deps({ auth: racingAuth }), {
        inviteId: link.inviteId,
        token: link.token,
        displayName: 'Nova',
        password: 'senha-nova-123',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'account-exists' } });
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      acceptingUid: null,
    });
    expect(await membersWithEmail(email)).toHaveLength(0);
    // A conta de quem chegou primeiro fica, e segue pelo fluxo de conta existente.
    expect((await auth.getUserByEmail(email)).uid).toBe(squatter);
  });

  it('convite cancelado no meio do aceite: a conta criada é desfeita', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'viewer', ['fans']);
    let created = '';
    const cancelingAuth = authWith(async (properties) => {
      const record = await auth.createUser(properties);
      created = record.uid;
      // O admin cancela enquanto a conta nasce.
      await ok('cancelStaffInvite', { inviteId: link.inviteId }, admin.token);
      return record;
    });
    await expect(
      acceptInvite(deps({ auth: cancelingAuth }), {
        inviteId: link.inviteId,
        token: link.token,
        displayName: 'Nova',
        password: 'senha-nova-123',
      }),
    ).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'canceled' } });
    expect(created).not.toBe('');
    expect(await accountExists(created)).toBe(false);
    await isGone(`staff/${created}`);
    // O cancelamento tira a marca com a conta ainda de pé: se o gatilho de
    // cadastro rodou nessa janela, a exclusão da conta limpa o perfil.
    await createTriggersSettled();
    await isGone(`users/${created}`);
    expect(await reservationsOf(created)).toEqual([]);
  });

  it('o admin tira o membro pendente no meio do aceite: a marca não volta e a conta sai', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'viewer', ['fans']);
    const accept = {
      inviteId: link.inviteId,
      token: link.token,
      displayName: 'Nova',
      password: 'senha-nova-123',
    };
    let reserved = '';
    const removingAuth = authWith(async (properties) => {
      reserved = properties.uid!;
      // A remoção cai entre a reserva e a conta nascer.
      await ok('removeStaffMember', { uid: reserved }, admin.token);
      return auth.createUser(properties);
    });
    await expect(acceptInvite(deps({ auth: removingAuth }), accept)).rejects.toMatchObject({
      code: 'aborted',
      details: { reason: 'conflict' },
    });
    expect(reserved).not.toBe('');
    expect(await exists(`staff/${reserved}`)).toBe(false);
    expect(await accountExists(reserved)).toBe(false);
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      acceptingUid: null,
    });
    // A conta nasceu sem marca, e o gatilho pode ter criado perfil e @: saem com ela.
    await createTriggersSettled();
    await isGone(`users/${reserved}`);
    expect(await reservationsOf(reserved)).toEqual([]);

    // A nova tentativa entra com outro uid.
    const { uid } = await ok<{ uid: string }>('acceptStaffInvite', accept);
    expect(uid).not.toBe(reserved);
    expect(await read(`staff/${uid}`)).toMatchObject({ status: 'active' });
    await signIn(email, 'senha-nova-123');
  });

  it('membro pendente removido pelo admin: a nova tentativa gera outro uid, sem reviver o antigo', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'editor', ['fans']);
    const stale = await crashedAccept(admin, link.inviteId, email);

    await ok('removeStaffMember', { uid: stale }, admin.token);
    expect(await exists(`staff/${stale}`)).toBe(false);
    expect(await accountExists(stale)).toBe(false);
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      acceptingUid: null,
    });

    const { uid } = await ok<{ uid: string }>('acceptStaffInvite', {
      inviteId: link.inviteId,
      token: link.token,
      displayName: 'Nova',
      password: 'senha-nova-123',
    });
    expect(uid).not.toBe(stale);
    // A exclusão atrasada da conta antiga (deleteUserProfile) não acerta o membro novo.
    await createTriggersSettled();
    expect(await read(`staff/${uid}`)).toMatchObject({ status: 'active', role: 'editor' });
    expect(await exists(`staff/${stale}`)).toBe(false);
    await signIn(email, 'senha-nova-123');
  });
});

describe('aceite com conta que já existe (linkStaffInvite)', () => {
  it('a fã liga o acesso ao painel na mesma conta, e o perfil de fã continua', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    const other = await signUpFan('Bruna Andrade');
    const profileBefore = await profileOf(fan.uid);
    const link = await invite(admin, fan.email, 'viewer', ['ranking']);
    const request = { inviteId: link.inviteId, token: link.token, displayName: 'Camila' };

    expect(await fails('linkStaffInvite', request)).toMatchObject(
      reason('UNAUTHENTICATED', 'unauthenticated'),
    );
    expect(await fails('linkStaffInvite', request, other.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'email-mismatch'),
    );
    expect(
      await fails('linkStaffInvite', { ...request, token: 'x'.repeat(43) }, fan.token),
    ).toMatchObject(reason('NOT_FOUND', 'invalid'));

    expect(await ok('linkStaffInvite', request, fan.token)).toEqual({ uid: fan.uid });
    expect(await read(`staff/${fan.uid}`)).toMatchObject({
      uid: fan.uid,
      email: fan.email,
      displayName: 'Camila',
      role: 'viewer',
      sections: ['ranking'],
      status: 'active',
      accountCreatedByInvite: false,
      inviteId: link.inviteId,
      invitedBy: admin.uid,
    });
    expect(await profileOf(fan.uid)).toEqual(profileBefore);
    expect((await auth.getUser(fan.uid)).emailVerified).toBe(true);
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'accepted',
      acceptedUid: fan.uid,
    });
    expect(await auditOf('invite.accepted', fan.email)).toMatchObject([
      {
        actorUid: fan.uid,
        details: { linkedExistingAccount: true, accountCreatedByInvite: false },
      },
    ]);

    expect(await fails('linkStaffInvite', request, fan.token)).toMatchObject(
      reason('FAILED_PRECONDITION', 'accepted'),
    );
    expect(
      await fails(
        'createStaffInvite',
        { email: fan.email, role: 'editor', sections: ['fans'] },
        admin.token,
      ),
    ).toMatchObject(reason('ALREADY_EXISTS', 'already-staff'));
  });

  it('convite pendente de quem já entrou por outro caminho: already-staff', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    const link = await invite(admin, fan.email, 'viewer', ['ranking']);
    const now = Timestamp.now();
    await db.doc(`staff/${fan.uid}`).set({
      uid: fan.uid,
      email: fan.email,
      displayName: 'Camila',
      role: 'viewer',
      sections: ['fans'],
      status: 'active',
      accountCreatedByInvite: false,
      inviteId: 'outro',
      invitedBy: admin.uid,
      createdAt: now,
      updatedAt: now,
      updatedBy: admin.uid,
    });
    const request = { inviteId: link.inviteId, token: link.token };
    expect(await fails('getStaffInvite', request)).toMatchObject(
      reason('FAILED_PRECONDITION', 'already-staff'),
    );
    expect(
      await fails('linkStaffInvite', { ...request, displayName: 'Camila' }, fan.token),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'already-staff'));
  });

  it('membro desativado não se reativa pelo link: member-disabled, e nada muda', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    // Desativada com o e-mail antigo no staff/{uid}; o e-mail de hoje da conta
    // não está em staff nenhum, então o convite para ele passa.
    const now = Timestamp.now();
    await db.doc(`staff/${fan.uid}`).set({
      uid: fan.uid,
      email: newEmail('antigo'),
      displayName: 'Camila',
      role: 'editor',
      sections: ['fans'],
      status: 'disabled',
      accountCreatedByInvite: false,
      inviteId: 'outro',
      invitedBy: admin.uid,
      createdAt: now,
      updatedAt: now,
      updatedBy: admin.uid,
    });
    const link = await invite(admin, fan.email, 'admin');
    expect(
      await fails(
        'linkStaffInvite',
        { inviteId: link.inviteId, token: link.token, displayName: 'Camila' },
        fan.token,
      ),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'member-disabled'));
    expect(await read(`staff/${fan.uid}`)).toMatchObject({ status: 'disabled', role: 'editor' });
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      acceptingUid: null,
      acceptedUid: null,
    });
    expect((await auth.getUser(fan.uid)).emailVerified).toBe(false);
  });

  it('conta que trocou de e-mail depois do token: email-mismatch, sem confirmar o e-mail novo', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const fan = await signUpFan('Camila Ribeiro');
    const link = await invite(admin, fan.email, 'viewer', ['fans']);
    // O token de antes ainda traz o e-mail convidado; a conta já tem outro.
    const changed = newEmail('trocado');
    await auth.updateUser(fan.uid, { email: changed });
    expect(
      await fails(
        'linkStaffInvite',
        { inviteId: link.inviteId, token: link.token, displayName: 'Camila' },
        fan.token,
      ),
    ).toMatchObject(reason('PERMISSION_DENIED', 'email-mismatch'));
    expect(await auth.getUser(fan.uid)).toMatchObject({ email: changed, emailVerified: false });
    expect(await exists(`staff/${fan.uid}`)).toBe(false);
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({ status: 'pending' });
  });

  it('conta criada por outra pessoa com o e-mail convidado: o token dela não usa o acesso', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    // Alguém cria a conta com o e-mail da pessoa convidada, liga um provedor
    // dela e guarda o token.
    const squatter = await signUpFan('Quem Criou');
    await auth.updateUser(squatter.uid, {
      providerToLink: { providerId: 'google.com', uid: 'google-quem-criou', email: squatter.email },
    });
    const link = await invite(admin, squatter.email, 'admin');
    // A pessoa convidada recupera a senha e entra: outro login, com auth_time maior.
    await auth.updateUser(squatter.uid, { password: 'senha-da-convidada-1' });
    await sleep(1100);
    const invitee = await signIn(squatter.email, 'senha-da-convidada-1');
    const linkedAt = claimsOf(invitee).auth_time;
    expect(linkedAt).toBeGreaterThan(claimsOf(squatter.token).auth_time);

    await ok(
      'linkStaffInvite',
      { inviteId: link.inviteId, token: link.token, displayName: 'Convidada' },
      invitee,
    );
    expect(await read(`staff/${squatter.uid}`)).toMatchObject({
      status: 'active',
      role: 'admin',
      accountCreatedByInvite: false,
      authValidAfter: linkedAt,
    });
    const account = await auth.getUser(squatter.uid);
    expect(account.emailVerified).toBe(true);
    // O provedor ligado antes da confirmação do e-mail sai; a senha fica.
    expect(account.providerData.map((info) => info.providerId)).toEqual(['password']);

    // O token de antes continua válido no Auth, mas não usa o acesso de admin.
    const newInvite = { email: newEmail('intruso'), role: 'admin' };
    expect(await fails('createStaffInvite', newInvite, squatter.token)).toMatchObject(
      reason('PERMISSION_DENIED', 'not-admin'),
    );
    // A sessão de quem ligou usa.
    await ok('createStaffInvite', newInvite, invitee);
  });
});

describe('reenviar e cancelar convites', () => {
  it('reenviar troca o token: o link antigo para de valer', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const first = await invite(admin, email, 'viewer', ['fans']);
    const before = (await read(`staffInvites/${first.inviteId}`))!;
    await sleep(5);
    const resent = await ok<InviteLink>(
      'resendStaffInvite',
      { inviteId: first.inviteId },
      admin.token,
    );
    expect(resent.inviteId).toBe(first.inviteId);
    expect(resent.emailStatus).toBe('skipped');
    const token = new URL(resent.inviteUrl).hash.slice(1);
    expect(token).not.toBe(first.token);

    expect(
      await fails('getStaffInvite', { inviteId: first.inviteId, token: first.token }),
    ).toMatchObject(reason('NOT_FOUND', 'invalid'));
    await ok('getStaffInvite', { inviteId: first.inviteId, token });
    const after = (await read(`staffInvites/${first.inviteId}`))!;
    expect(after).toMatchObject({
      sendCount: 2,
      tokenHash: hashInviteToken(token),
      status: 'pending',
    });
    expect(after.expiresAt.toMillis()).toBeGreaterThan(before.expiresAt.toMillis());
    expect(after.expiresAt.toMillis() - after.lastSentAt.toMillis()).toBe(SEVEN_DAYS);
    expect(await auditOf('invite.resent', email)).toMatchObject([
      { actorUid: admin.uid, details: { inviteId: first.inviteId, sendCount: 2 } },
    ]);
  });

  it('convite vencido pode ser reenviado e volta a valer', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const link = await invite(admin, newEmail(), 'viewer', ['fans']);
    await db
      .doc(`staffInvites/${link.inviteId}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const resent = await ok<InviteLink>(
      'resendStaffInvite',
      { inviteId: link.inviteId },
      admin.token,
    );
    const token = new URL(resent.inviteUrl).hash.slice(1);
    await ok('getStaffInvite', { inviteId: link.inviteId, token });
  });

  it('cancelar convite com aceite que caiu no meio: marca e conta saem, e o e-mail volta a ser convidável', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'editor', ['fans']);
    const stale = await crashedAccept(admin, link.inviteId, email);

    await ok('cancelStaffInvite', { inviteId: link.inviteId }, admin.token);
    expect(await exists(`staff/${stale}`)).toBe(false);
    expect(await accountExists(stale)).toBe(false);
    const again = await invite(admin, email, 'viewer', ['fans']);
    // Sem a conta que sobrou, o novo convite segue como conta nova.
    expect(
      await ok<{ accountExists: boolean }>('getStaffInvite', {
        inviteId: again.inviteId,
        token: again.token,
      }),
    ).toMatchObject({ accountExists: false });
  });

  it('convidar de novo por cima de um aceite que caiu no meio troca o convite e limpa a reserva', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const first = await invite(admin, email, 'editor', ['fans']);
    const stale = await crashedAccept(admin, first.inviteId, email);

    const second = await invite(admin, email, 'viewer', ['ranking']);
    expect(await read(`staffInvites/${first.inviteId}`)).toMatchObject({
      status: 'canceled',
      cancelReason: 'replaced',
    });
    expect(await exists(`staff/${stale}`)).toBe(false);
    expect(await accountExists(stale)).toBe(false);
    const { uid } = await ok<{ uid: string }>('acceptStaffInvite', {
      inviteId: second.inviteId,
      token: second.token,
      displayName: 'Nova',
      password: 'senha-nova-123',
    });
    expect(await read(`staff/${uid}`)).toMatchObject({
      status: 'active',
      role: 'viewer',
      sections: ['ranking'],
    });
  });

  it('cancelar: o link morre, e aceito ou cancelado não se cancela nem reenvia', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const email = newEmail();
    const link = await invite(admin, email, 'viewer', ['fans']);
    expect(await ok('cancelStaffInvite', { inviteId: link.inviteId }, admin.token)).toEqual({
      ok: true,
    });
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'canceled',
      cancelReason: 'admin',
      canceledBy: admin.uid,
    });
    expect(
      await fails('acceptStaffInvite', {
        inviteId: link.inviteId,
        token: link.token,
        displayName: 'Nova',
        password: 'senha-nova-123',
      }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'canceled'));
    for (const name of ['cancelStaffInvite', 'resendStaffInvite']) {
      expect(await fails(name, { inviteId: link.inviteId }, admin.token)).toMatchObject(
        reason('FAILED_PRECONDITION', 'not-pending'),
      );
    }
    expect(await fails('cancelStaffInvite', { inviteId: 'naoexiste' }, admin.token)).toMatchObject(
      reason('NOT_FOUND', 'invite-not-found'),
    );
    expect(await auditOf('invite.canceled', email)).toMatchObject([
      { actorUid: admin.uid, details: { inviteId: link.inviteId, reason: 'admin' } },
    ]);
  });
});

describe('gestão da equipe', () => {
  /** Membro que entrou pelo convite, com conta criada no aceite. */
  async function acceptedMember(admin: Member, role: 'editor' | 'viewer', sections: string[]) {
    const email = newEmail();
    const link = await invite(admin, email, role, sections);
    const { uid } = await ok<{ uid: string }>('acceptStaffInvite', {
      inviteId: link.inviteId,
      token: link.token,
      displayName: 'Nova Pessoa',
      password: 'senha-nova-123',
    });
    return { uid, email, token: await signIn(email, 'senha-nova-123') };
  }

  it('admin muda papel e seções; a auditoria guarda antes e depois', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const member = await acceptedMember(admin, 'editor', ['fans']);
    await ok(
      'updateStaffMember',
      { uid: member.uid, role: 'viewer', sections: ['ranking', 'fans'] },
      admin.token,
    );
    expect(await read(`staff/${member.uid}`)).toMatchObject({
      role: 'viewer',
      sections: ['ranking', 'fans'],
      updatedBy: admin.uid,
    });
    expect(await auditOf('member.updated', member.email)).toMatchObject([
      {
        actorUid: admin.uid,
        actorName: 'Admin Um',
        targetUid: member.uid,
        details: {
          from: { role: 'editor', sections: ['fans'] },
          to: { role: 'viewer', sections: ['ranking', 'fans'] },
        },
      },
    ]);

    await ok('updateStaffMember', { uid: member.uid, role: 'admin' }, admin.token);
    expect(await read(`staff/${member.uid}`)).toMatchObject({
      role: 'admin',
      sections: [...SECTION_IDS],
    });

    for (const [data, status, why] of [
      [{ uid: member.uid, role: 'viewer', sections: [] }, 'INVALID_ARGUMENT', 'invalid-sections'],
      [{ uid: member.uid }, 'INVALID_ARGUMENT', 'invalid-request'],
      [{ uid: 'ninguem', role: 'viewer', sections: ['fans'] }, 'NOT_FOUND', 'not-member'],
    ] as const) {
      expect(await fails('updateStaffMember', data, admin.token)).toMatchObject(
        reason(status, why),
      );
    }
  });

  it('ninguém muda, desativa ou remove o próprio acesso', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    await seedMember('Admin Dois', 'admin');
    for (const [name, data] of [
      ['updateStaffMember', { uid: admin.uid, role: 'viewer', sections: ['fans'] }],
      ['setStaffMemberActive', { uid: admin.uid, active: false }],
      ['removeStaffMember', { uid: admin.uid }],
    ] as const) {
      expect(await fails(name, data, admin.token)).toMatchObject(
        reason('FAILED_PRECONDITION', 'self'),
      );
    }
    expect(await read(`staff/${admin.uid}`)).toMatchObject({ role: 'admin', status: 'active' });
  });

  it('desativar corta o painel e deixa a conta; reativar devolve', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const other = await seedMember('Admin Dois', 'admin');
    await ok('setStaffMemberActive', { uid: other.uid, active: false }, admin.token);
    expect(await read(`staff/${other.uid}`)).toMatchObject({ status: 'disabled' });
    expect((await auth.getUser(other.uid)).disabled).toBe(false);
    // O token de antes continua válido no Auth, mas o painel já não aceita.
    expect(
      await fails(
        'createStaffInvite',
        { email: newEmail(), role: 'viewer', sections: ['fans'] },
        other.token,
      ),
    ).toMatchObject(reason('PERMISSION_DENIED', 'not-admin'));

    await ok('setStaffMemberActive', { uid: other.uid, active: true }, admin.token);
    expect(await read(`staff/${other.uid}`)).toMatchObject({ status: 'active' });
    expect((await auditOf('member.disabled', other.email)).length).toBe(1);
    expect((await auditOf('member.enabled', other.email)).length).toBe(1);
  });

  it('dois admins rebaixando um ao outro ao mesmo tempo: sobra um admin ativo', async () => {
    const first = await seedMember('Admin Um', 'admin');
    const second = await seedMember('Admin Dois', 'admin');
    const responses = await Promise.all([
      call(
        'updateStaffMember',
        { uid: second.uid, role: 'viewer', sections: ['fans'] },
        first.token,
      ),
      call(
        'updateStaffMember',
        { uid: first.uid, role: 'viewer', sections: ['fans'] },
        second.token,
      ),
    ]);
    expect(responses.filter((response) => response.error)).toHaveLength(1);
    const admins = (await db.collection('staff').where('role', '==', 'admin').get()).docs.filter(
      (doc) => doc.get('status') === 'active',
    );
    expect(admins).toHaveLength(1);
  });

  it('dois admins desativando um ao outro ao mesmo tempo: sobra um admin ativo', async () => {
    const first = await seedMember('Admin Um', 'admin');
    const second = await seedMember('Admin Dois', 'admin');
    const responses = await Promise.all([
      call('setStaffMemberActive', { uid: second.uid, active: false }, first.token),
      call('setStaffMemberActive', { uid: first.uid, active: false }, second.token),
    ]);
    expect(responses.filter((response) => response.error)).toHaveLength(1);
    const statuses = [await read(`staff/${first.uid}`), await read(`staff/${second.uid}`)].map(
      (member) => member!.status,
    );
    expect(statuses.sort()).toEqual(['active', 'disabled']);
  });

  it('admin desativado perde os convites que criou ou reenviou, e o link deles para de valer', async () => {
    const first = await seedMember('Admin Um', 'admin');
    const second = await seedMember('Admin Dois', 'admin');
    // Um convite de admin para um e-mail que ele mesmo lê, e o convite de um
    // colega que ele reenviou (e guardou o link novo).
    const altEmail = newEmail('alt');
    const colleagueEmail = newEmail();
    const own = await invite(first, altEmail, 'admin');
    const colleague = await invite(second, colleagueEmail, 'editor', ['fans']);
    const resent = await ok<InviteLink>(
      'resendStaffInvite',
      { inviteId: colleague.inviteId },
      first.token,
    );
    const untouched = await invite(second, newEmail(), 'viewer', ['fans']);

    await ok('setStaffMemberActive', { uid: first.uid, active: false }, second.token);
    for (const id of [own.inviteId, colleague.inviteId]) {
      expect(await read(`staffInvites/${id}`)).toMatchObject({
        status: 'canceled',
        cancelReason: 'admin',
        canceledBy: second.uid,
      });
    }
    expect(await read(`staffInvites/${untouched.inviteId}`)).toMatchObject({ status: 'pending' });
    expect(
      await fails('acceptStaffInvite', {
        inviteId: own.inviteId,
        token: own.token,
        displayName: 'Outra Conta',
        password: 'senha-nova-123',
      }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'canceled'));
    expect(
      await fails('getStaffInvite', {
        inviteId: colleague.inviteId,
        token: new URL(resent.inviteUrl).hash.slice(1),
      }),
    ).toMatchObject(reason('FAILED_PRECONDITION', 'canceled'));
    const [disabled] = await auditOf('member.disabled', first.email);
    expect([...disabled!.details.canceledInviteIds].sort()).toEqual(
      [own.inviteId, colleague.inviteId].sort(),
    );
    for (const [email, inviteId] of [
      [altEmail, own.inviteId],
      [colleagueEmail, colleague.inviteId],
    ]) {
      expect(await auditOf('invite.canceled', email)).toMatchObject([
        {
          actorUid: second.uid,
          details: { inviteId, reason: 'admin', issuerLostAdmin: first.uid },
        },
      ]);
    }

    // Reativar não devolve os convites.
    await ok('setStaffMemberActive', { uid: first.uid, active: true }, second.token);
    expect(await read(`staffInvites/${own.inviteId}`)).toMatchObject({ status: 'canceled' });
  });

  it('admin rebaixado ou removido também perde os convites dele; os de quem fica continuam', async () => {
    const first = await seedMember('Admin Um', 'admin');
    const second = await seedMember('Admin Dois', 'admin');
    const third = await seedMember('Admin Três', 'admin');
    const byFirst = await invite(first, newEmail(), 'viewer', ['fans']);
    const byThird = await invite(third, newEmail(), 'admin');
    const bySecond = await invite(second, newEmail(), 'viewer', ['fans']);

    await ok(
      'updateStaffMember',
      { uid: first.uid, role: 'editor', sections: ['fans'] },
      second.token,
    );
    expect(await read(`staffInvites/${byFirst.inviteId}`)).toMatchObject({
      status: 'canceled',
      cancelReason: 'admin',
    });
    expect(await auditOf('member.updated', first.email)).toMatchObject([
      { details: { canceledInviteIds: [byFirst.inviteId] } },
    ]);

    await ok('removeStaffMember', { uid: third.uid }, second.token);
    expect(await read(`staffInvites/${byThird.inviteId}`)).toMatchObject({
      status: 'canceled',
      canceledBy: second.uid,
    });

    // Mudar as seções de quem já não é admin não cancela nada.
    await ok('updateStaffMember', { uid: first.uid, sections: ['fans', 'ranking'] }, second.token);
    expect(await read(`staffInvites/${bySecond.inviteId}`)).toMatchObject({ status: 'pending' });
  });

  it('remover: conta criada pelo convite sai do Auth; conta de fã fica', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const member = await acceptedMember(admin, 'editor', ['fans']);
    expect(await ok('removeStaffMember', { uid: member.uid }, admin.token)).toEqual({ ok: true });
    expect(await exists(`staff/${member.uid}`)).toBe(false);
    expect(await accountExists(member.uid)).toBe(false);
    expect(await auditOf('member.removed', member.email)).toMatchObject([
      { actorUid: admin.uid, targetUid: member.uid, details: { accountDeleted: true } },
    ]);

    const fan = await signUpFan('Camila Ribeiro');
    const link = await invite(admin, fan.email, 'viewer', ['fans']);
    await ok(
      'linkStaffInvite',
      { inviteId: link.inviteId, token: link.token, displayName: 'Camila' },
      fan.token,
    );
    await ok('removeStaffMember', { uid: fan.uid }, admin.token);
    expect(await exists(`staff/${fan.uid}`)).toBe(false);
    expect(await accountExists(fan.uid)).toBe(true);
    expect(await exists(`users/${fan.uid}`)).toBe(true);
    expect(await auditOf('member.removed', fan.email)).toMatchObject([
      { details: { accountDeleted: false } },
    ]);
    expect(await fails('removeStaffMember', { uid: fan.uid }, admin.token)).toMatchObject(
      reason('NOT_FOUND', 'not-member'),
    );
  });

  it('quem não é admin ativo não usa as funções de admin', async () => {
    const admin = await seedMember('Admin Um', 'admin');
    const editor = await seedMember('Editora', 'editor', ['fans', 'audit']);
    const fan = await signUpFan('Camila Ribeiro');
    const disabled = await seedMember('Admin Desativado', 'admin');
    await ok('setStaffMemberActive', { uid: disabled.uid, active: false }, admin.token);
    const link = await invite(admin, newEmail(), 'viewer', ['fans']);

    const adminCalls: [string, unknown][] = [
      ['createStaffInvite', { email: newEmail(), role: 'viewer', sections: ['fans'] }],
      ['resendStaffInvite', { inviteId: link.inviteId }],
      ['cancelStaffInvite', { inviteId: link.inviteId }],
      ['updateStaffMember', { uid: admin.uid, role: 'viewer', sections: ['fans'] }],
      ['setStaffMemberActive', { uid: admin.uid, active: false }],
      ['removeStaffMember', { uid: admin.uid }],
    ];
    for (const [name, data] of adminCalls) {
      for (const caller of [editor, fan, disabled]) {
        expect(await fails(name, data, caller.token)).toMatchObject(
          reason('PERMISSION_DENIED', 'not-admin'),
        );
      }
      expect(await fails(name, data)).toMatchObject(reason('UNAUTHENTICATED', 'unauthenticated'));
    }
    expect(await read(`staff/${admin.uid}`)).toMatchObject({ role: 'admin', status: 'active' });
    expect(await read(`staffInvites/${link.inviteId}`)).toMatchObject({
      status: 'pending',
      sendCount: 1,
    });
  });
});

describe('gatilhos de conta com a equipe', () => {
  // handleUserCreated e deleteUserData com a marca da equipe: profile.emulator.test.ts.
  it('conta da equipe excluída no Auth perde o staff/{uid}', async () => {
    const member = await seedMember('Editora', 'editor', ['fans']);
    await auth.deleteUser(member.uid);
    await isGone(`staff/${member.uid}`);
  });
});

describe('primeiro admin (scripts/staff-bootstrap-invite.mjs)', () => {
  const runScript = promisify(execFile);
  const script = resolve(__dirname, '../../scripts/staff-bootstrap-invite.mjs');
  const bootstrap = (email: string, env: NodeJS.ProcessEnv = process.env) =>
    runScript(process.execPath, [script, email], { env }).then(
      ({ stdout }) => ({ code: 0, stdout, stderr: '' }),
      (error: { code: number; stdout: string; stderr: string }) => error,
    );

  it('sem o emulador e sem --project, recusa antes de gravar em qualquer projeto', async () => {
    // Credencial que não existe: se o script seguisse, falharia antes de falar com o Google.
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GOOGLE_APPLICATION_CREDENTIALS: resolve(__dirname, 'nao-existe.json'),
    };
    delete env.FIRESTORE_EMULATOR_HOST;
    const email = newEmail('primeiro');
    const refused = await bootstrap(email, env);
    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain('--project');
    expect(refused.stdout).not.toContain('/convite/');
    expect((await db.collection('staffInvites').where('email', '==', email).get()).empty).toBe(
      true,
    );
  });

  it('cria o convite do primeiro admin e recusa repetir ou passar por cima de um admin', async () => {
    const email = newEmail('primeiro');
    const first = await bootstrap(email);
    expect(first.code).toBe(0);
    const inviteUrl = first.stdout.split(/\r?\n/).find((line) => line.includes('/convite/'))!;
    const url = new URL(inviteUrl);
    const inviteId = url.pathname.split('/').pop()!;
    const token = url.hash.slice(1);
    expect(await read(`staffInvites/${inviteId}`)).toMatchObject({
      email,
      role: 'admin',
      sections: [...SECTION_IDS],
      status: 'pending',
      invitedBy: null,
      invitedByName: 'Equipe ImagineUP',
      emailStatus: 'skipped',
      tokenHash: hashInviteToken(token),
    });
    expect(await auditOf('invite.created', email)).toMatchObject([
      { actorUid: null, actorName: 'Equipe ImagineUP', details: { bootstrap: true } },
    ]);

    // Convite pendente para o mesmo e-mail: não cria outro.
    const again = await bootstrap(email);
    expect(again.code).toBe(1);
    expect(again.stderr).toContain('convite pendente');

    const { uid } = await ok<{ uid: string }>('acceptStaffInvite', {
      inviteId,
      token,
      displayName: 'Primeira Admin',
      password: 'senha-nova-123',
    });
    expect(await read(`staff/${uid}`)).toMatchObject({
      role: 'admin',
      status: 'active',
      invitedBy: null,
    });

    // Com um admin ativo, os convites saem do painel.
    const blocked = await bootstrap(newEmail('segundo'));
    expect(blocked.code).toBe(1);
    expect(blocked.stderr).toContain('admin ativo');
  });

  it('convite do primeiro admin vencido é trocado por um novo', async () => {
    const email = newEmail('primeiro');
    const first = await bootstrap(email);
    const firstId = new URL(
      first.stdout.split(/\r?\n/).find((line) => line.includes('/convite/'))!,
    ).pathname
      .split('/')
      .pop()!;
    await db
      .doc(`staffInvites/${firstId}`)
      .update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const second = await bootstrap(email);
    expect(second.code).toBe(0);
    expect(await read(`staffInvites/${firstId}`)).toMatchObject({
      status: 'canceled',
      cancelReason: 'replaced',
    });
  });
});
