import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { FieldPath, Timestamp, type Query } from 'firebase-admin/firestore';
import { describe, expect, it } from 'vitest';

import { dayKey } from '../src/day';
import { FAN_CLUB_RULES_VERSION } from '../src/fan-clubs';
import {
  deleteFanAccount,
  exportFanData,
  FAN_DATA_FIRST_KEYS,
  FAN_DATA_PARENTS,
  FAN_DATA_PARTS,
  FAN_DATA_SOURCES,
  knownSubcollections,
  type ExportPage,
  type FanDataSource,
} from '../src/fan-data';
import { fanPhotoFiles, seedFanPhoto } from '../src/fan-profile';
import { EMULATOR_INVITE_KEY, personKey } from '../src/invites';
import { seedPastSeasons } from '../src/ranking';
import { emptyStaffLimit, staffLimitDoc, staffLimitId } from '../src/staff/limits';
import { SECTION_IDS } from '../src/staff/model';
import {
  callable,
  central,
  localApi,
  post,
  seedMember,
  show,
  signUpFan,
  unique,
  useEmulators,
  waitFor,
  type CallError,
  type Fan,
  type Member,
} from './support';

/**
 * Os pedidos de dados de um fã pela LGPD (seção 32, frente A6, 32.10 de
 * docs/arquitetura-api.md): o `exportFanData` e o `deleteFanAccount`, só de
 * admin, com o e-mail da conta, o login recente, os tetos do dia e a
 * auditoria só com o uid; o arquivo de um fã com dado em toda fonte da
 * `FAN_DATA_SOURCES`, sem dado de outra pessoa nem da equipe, com o extrato
 * em duas páginas e as denúncias inteiras na primeira chamada; a ponta do
 * "dado novo" (o `listCollections()` dentro da lista); e a exclusão, com o
 * gatilho tratando cada fonte como a lista diz. Desde o fã-clube (seção 34,
 * 34.7, etapa 1 de 34.14), o fã é também gestor aprovado: a candidatura, o
 * privado e o fã-clube vêm no arquivo, e a exclusão apaga os dois primeiros e
 * deixa a lápide. Desde a etapa 2, ele publica com foto (a parte
 * `publicacoesDeFaClube`, sem quem revisou) e denuncia uma publicação de outro
 * fã-clube (sem a rodada); a exclusão apaga as duas, a pasta das fotos e deixa
 * o item da fila da publicação dele em `author_deleted`.
 */
const env = useEmulators('dados-do-fa', [
  'createUserProfile',
  'deleteUserProfile',
  'queueFanProfileSync',
  'syncFanProfile',
  'exportFanData',
  'deleteFanAccount',
  'adjustFanPoints',
  'createReward',
  'setRewardStatus',
  'setRedemptionStatus',
  'moderateComment',
  'decideFanClub',
]);
const { db, auth, bucket } = env;
const files = fanPhotoFiles(() => bucket);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Prazo dos testes que montam um fã inteiro e esperam o gatilho da exclusão. */
const LONG_MS = 240_000;
const JPEG = readFileSync(resolve(__dirname, '../../scripts/seed-assets/foto-teste.jpg'));
const save = async (path: string, bytes: Uint8Array) => {
  await bucket.file(path).save(Buffer.from(bytes), { resumable: false, contentType: 'image/jpeg' });
};
const read = async (path: string) => (await db.doc(path).get()).data();
const exists = async (path: string) => (await db.doc(path).get()).exists;

type Caller = Pick<Member, 'token'>;
type Item = Record<string, unknown>;
type ExportStart = Record<string, unknown> & { partes: string[] };

async function ok<T = Record<string, unknown>>(name: string, data: unknown, who: Caller) {
  const { result, error } = await callable<T>(env, name, data, who.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

async function failure(name: string, data: unknown, who?: Caller): Promise<CallError> {
  const { error } = await callable(env, name, data, who?.token);
  if (!error) throw new Error(`${name} deveria ter falhado.`);
  return error;
}

async function audits(action: string) {
  const snap = await db.collection('staffAudit').where('action', '==', action).get();
  return snap.docs.map((doc) => doc.data());
}

async function limitOf(uid: string) {
  return read(`staffLimits/${staffLimitId(uid, dayKey(Date.now()))}`);
}

/** Quem chama no processo do teste, como o onCall entrega, com o login de `authTime` (s). */
const callerOf = (member: Member, authTime = Math.floor(Date.now() / 1000)) => ({
  uid: member.uid,
  token: { auth_time: authTime },
});

/** O pedido do fã: o uid e o e-mail da conta, como a equipe digita. */
const request = (fan: Pick<Fan, 'uid' | 'email'>, extra: Record<string, unknown> = {}) => ({
  uid: fan.uid,
  email: fan.email,
  ...extra,
});

/** O claim pelo código digitado no cadastro. */
const codeBody = (code: string) => ({ code, via: 'code', link: null, openedAt: null });

/**
 * A exportação inteira, como o painel faz (32.6, item 5): a primeira chamada
 * e, para cada parte de `partes`, as páginas até o `after` null, devolvendo
 * o `after` como veio. O arquivo é o começo sem o `partes`, mais cada parte.
 */
async function exportAll(admin: Member, fan: Pick<Fan, 'uid' | 'email'>) {
  const start = await ok<ExportStart>('exportFanData', request(fan), admin);
  const file: Record<string, unknown> = { ...start };
  delete file.partes;
  const pages: Record<string, ExportPage[]> = {};
  for (const part of start.partes) {
    const items: unknown[] = [];
    let after: string | null | undefined;
    do {
      const page: ExportPage = await ok<ExportPage>(
        'exportFanData',
        { uid: fan.uid, part, ...(after === undefined ? {} : { after }) },
        admin,
      );
      (pages[part] ??= []).push(page);
      items.push(...page.items);
      after = page.after;
    } while (after !== null);
    file[part] = items;
  }
  return { start, file, pages };
}

/** Um membro da equipe que também é fã, na mesma conta, no status dado. */
async function staffFan(status: 'active' | 'pending' | 'disabled'): Promise<Fan> {
  const fan = await signUpFan(db, 'Fã da Equipe');
  const now = Timestamp.now();
  await db.doc(`staff/${fan.uid}`).set({
    uid: fan.uid,
    email: fan.email,
    displayName: 'Fã da Equipe',
    role: 'editor',
    sections: ['fans'],
    status,
    accountCreatedByInvite: false,
    inviteId: 'semente',
    invitedBy: null,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
  });
  return fan;
}

describe('quem pede os dados de um fã', () => {
  it('sem login, uid fora do formato, a própria conta e o e-mail torto; editor e leitor: admin-only; desativado: not-staff', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const editor = await seedMember(env, 'Editora', 'editor', [...SECTION_IDS]);
    const viewer = await seedMember(env, 'Leitor', 'viewer', [...SECTION_IDS]);
    const disabled = await seedMember(env, 'Desativada', 'admin', [], 'disabled');
    const fan = await signUpFan(db, 'Camila Ribeiro');

    for (const name of ['exportFanData', 'deleteFanAccount']) {
      expect((await failure(name, request(fan))).details?.reason, name).toBe('unauthenticated');
      expect((await failure(name, request(fan, { uid: 'a/b' }), admin)).details, name).toEqual({
        reason: 'invalid-request',
        field: 'uid',
      });
      expect(
        (await failure(name, { uid: admin.uid, email: admin.email }, admin)).details?.reason,
        name,
      ).toBe('self');
      expect((await failure(name, request(fan, { email: 'sem-arroba' }), admin)).details).toEqual({
        reason: 'invalid-request',
        field: 'email',
      });
      for (const member of [editor, viewer]) {
        const refused = await failure(name, request(fan), member);
        expect(refused.details?.reason, name).toBe('admin-only');
        expect(refused.message).toBe('Só um admin do painel pode fazer isso.');
      }
      expect((await failure(name, request(fan), disabled)).details?.reason, name).toBe('not-staff');
    }

    // As páginas: a parte e o `after` conferidos antes do acesso; o editor não lê.
    const page = (extra: Record<string, unknown>) => ({ uid: fan.uid, ...extra });
    expect((await failure('exportFanData', page({ part: 'fotos' }), admin)).details).toEqual({
      reason: 'invalid-request',
      field: 'part',
    });
    for (const extra of [
      { part: 'extrato', after: null },
      { part: 'extrato', after: 'a/b' },
      { part: 'comentarios', after: 'c1' },
    ]) {
      expect((await failure('exportFanData', page(extra), admin)).details).toEqual({
        reason: 'invalid-request',
        field: 'after',
      });
    }
    expect(
      (await failure('exportFanData', page({ part: 'extrato' }), editor)).details?.reason,
    ).toBe('admin-only');
    expect((await failure('exportFanData', page({ part: 'extrato' }))).details?.reason).toBe(
      'unauthenticated',
    );

    // Nada auditado, nada contado e a conta no lugar.
    expect(await audits('fan.data.exported')).toEqual([]);
    expect(await audits('fan.account.deleted')).toEqual([]);
    expect(await limitOf(admin.uid)).toBeUndefined();
    expect((await auth.getUser(fan.uid)).uid).toBe(fan.uid);
  });

  it('o login de mais de 10 minutos recusa a primeira chamada e a exclusão; as páginas passam', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const deps = { db, auth };
    // O emulador do Auth dá o token com o login de agora: o núcleo, chamado
    // direto, recebe o `auth_time` de 11 minutos atrás.
    const old = callerOf(admin, Math.floor(Date.now() / 1000) - 11 * 60);
    await expect(exportFanData(deps, old, request(fan))).rejects.toMatchObject({
      code: 'failed-precondition',
      message: 'Entre de novo com a sua senha para continuar.',
      details: { reason: 'recent-login-required' },
    });
    await expect(deleteFanAccount(deps, old, request(fan))).rejects.toMatchObject({
      details: { reason: 'recent-login-required' },
    });
    expect(await exportFanData(deps, old, { uid: fan.uid, part: 'centrais' })).toEqual({
      part: 'centrais',
      items: [],
      after: null,
    });
    expect(await limitOf(admin.uid)).toBeUndefined();

    // No limite exato de 600 s, passa.
    const now = Math.floor(Date.now() / 1000) * 1000;
    const atLimit = callerOf(admin, now / 1000 - 600);
    expect(await exportFanData({ ...deps, now: () => now }, atLimit, request(fan))).toMatchObject({
      uid: fan.uid,
    });
    expect((await auth.getUser(fan.uid)).uid).toBe(fan.uid);
  });

  it('o e-mail confere sem diferença de maiúsculas; outro e-mail recusa sem dizer o certo; sem conta, fan-not-found', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');

    for (const name of ['exportFanData', 'deleteFanAccount']) {
      const refused = await failure(name, request(fan, { email: 'outra@teste.dev' }), admin);
      expect(refused.details, name).toEqual({ reason: 'email-mismatch' });
      expect(refused.message).toBe(
        'Este e-mail não é o da conta deste fã. Confira o e-mail do pedido.',
      );
      expect(JSON.stringify(refused)).not.toContain(fan.email);
      expect(
        (await failure(name, { uid: 'semconta123', email: 'x@teste.dev' }, admin)).details?.reason,
        name,
      ).toBe('fan-not-found');
    }
    expect((await auth.getUser(fan.uid)).uid).toBe(fan.uid);
    expect(await audits('fan.data.exported')).toEqual([]);

    const start = await ok<ExportStart>(
      'exportFanData',
      request(fan, { email: `  ${fan.email.toUpperCase()} ` }),
      admin,
    );
    expect(start.conta).toMatchObject({ email: fan.email });
    expect(await audits('fan.data.exported')).toHaveLength(1);
  });
});

describe('os tetos do dia e a auditoria', () => {
  it('a 21ª exportação do dia recusa; as páginas não contam nem auditam; a auditoria só com o uid', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const now = Date.now();
    // 19 exportações já no dia, gravadas como o addStaffLimit grava.
    await db
      .doc(`staffLimits/${staffLimitId(admin.uid, dayKey(now))}`)
      .set(staffLimitDoc(admin.uid, now, { ...emptyStaffLimit(), dataExports: 19 }));

    await ok('exportFanData', request(fan), admin);
    for (const part of FAN_DATA_PARTS) {
      expect(await ok<ExportPage>('exportFanData', { uid: fan.uid, part }, admin)).toMatchObject({
        part,
        after: null,
      });
    }
    expect((await limitOf(admin.uid))?.dataExports).toBe(20);

    const refused = await failure('exportFanData', request(fan), admin);
    expect(refused.status).toBe('RESOURCE_EXHAUSTED');
    expect(refused.details).toEqual({ reason: 'export-daily-limit', max: 20 });
    expect(refused.message).toBe('Você chegou ao limite de 20 exportações de dados hoje.');
    // A página continua, sem teto.
    expect(await ok<ExportPage>('exportFanData', { uid: fan.uid, part: 'extrato' }, admin)).toEqual(
      { part: 'extrato', items: [], after: null },
    );

    const entries = await audits('fan.data.exported');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      actorUid: admin.uid,
      actorName: 'Admin',
      targetEmail: '',
      targetUid: fan.uid,
      details: { uid: fan.uid },
      section: 'fans',
      targets: [`fan:${fan.uid}`],
    });
    expect(Object.keys(entries[0]!.details as Item)).toEqual(['uid']);
    expect(JSON.stringify(entries)).not.toContain(fan.email);
  });

  it('a 6ª exclusão do dia recusa; o mesmo uid de novo no dia não conta nem audita', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');

    // O `deleteUser` falha depois da transação: a auditoria e o uid ficam.
    const failing = {
      db,
      auth: {
        getUser: (uid: string) => auth.getUser(uid),
        deleteUser: async () => {
          throw new Error('O Auth não respondeu.');
        },
      },
    };
    await expect(deleteFanAccount(failing, callerOf(admin), request(fan))).rejects.toThrow(
      'O Auth não respondeu.',
    );
    expect(await audits('fan.account.deleted')).toHaveLength(1);
    expect((await limitOf(admin.uid))?.deletedUids).toEqual([fan.uid]);
    expect((await auth.getUser(fan.uid)).uid).toBe(fan.uid);

    // A nova tentativa no mesmo dia: exclui sem somar nem auditar de novo.
    expect(await ok('deleteFanAccount', request(fan), admin)).toEqual({ status: 'deleted' });
    expect(await audits('fan.account.deleted')).toHaveLength(1);
    expect((await limitOf(admin.uid))?.deletedUids).toEqual([fan.uid]);

    const deleted = [fan];
    for (let n = 0; n < 4; n += 1) {
      const next = await signUpFan(db);
      expect(await ok('deleteFanAccount', request(next), admin)).toEqual({ status: 'deleted' });
      deleted.push(next);
    }
    expect((await limitOf(admin.uid))?.deletedUids).toEqual(deleted.map((item) => item.uid));
    expect(await audits('fan.account.deleted')).toHaveLength(5);

    const sixth = await signUpFan(db);
    const refused = await failure('deleteFanAccount', request(sixth), admin);
    expect(refused.status).toBe('RESOURCE_EXHAUSTED');
    expect(refused.details).toEqual({ reason: 'deletion-daily-limit', max: 5 });
    expect(refused.message).toBe('Você chegou ao limite de 5 exclusões de conta hoje.');
    expect((await auth.getUser(sixth.uid)).uid).toBe(sixth.uid);
    expect(await audits('fan.account.deleted')).toHaveLength(5);

    // A auditoria de cada exclusão: só o uid, o alvo e a seção.
    for (const entry of await audits('fan.account.deleted')) {
      expect(Object.keys(entry.details as Item)).toEqual(['uid']);
      expect(entry).toMatchObject({ targetEmail: '', section: 'fans' });
      expect(entry.targets).toEqual([`fan:${(entry.details as Item).uid as string}`]);
    }
  });
});

/**
 * O estado de cada fonte depois da exclusão, como a `FAN_DATA_SOURCES` diz
 * (`deletion.effect`): a lista de fontes que ainda não chegaram lá. Uma fonte
 * nova sem conferência aqui falha o teste.
 */
async function leftovers(
  uid: string,
  known: {
    redemptionId: string;
    inviteeUid: string;
    inviterUid: string;
    inviterEntries: string[];
    /** O fã-clube que o fã gere (seção 34): vira lápide. */
    clubId: string;
    /** O prêmio que ele recebeu (etapa 5): o registro fica, e o pedido aberto é cancelado. */
    grantId: string;
    prizeCode: string;
  },
): Promise<string[]> {
  const left: string[] = [];
  const none = async (query: Query) => (await query.limit(1).get()).empty;
  for (const source of FAN_DATA_SOURCES) {
    if (!(await settled(source))) left.push(source.id);
  }
  return left;

  async function settled(source: FanDataSource): Promise<boolean> {
    const { read: how } = source;
    const { effect } = source.deletion;
    if (effect === 'account') {
      return auth.getUser(uid).then(
        () => false,
        (error: { code?: string }) => error.code === 'auth/user-not-found',
      );
    }
    if (effect === 'deleted') {
      switch (how.kind) {
        case 'doc':
          return !(await exists(`${how.collection}/${uid}`));
        case 'sub':
          return none(db.collection(`${how.parent}/${uid}/${how.name}`));
        case 'subdoc':
          return !(await exists(`${how.parent}/${uid}/${how.name}/${how.id}`));
        case 'equal':
          return none(db.collection(how.collection).where(how.field, '==', uid));
        case 'group':
          return none(db.collectionGroup(how.group).where(how.field, '==', uid));
        case 'standings': {
          const seasons = await db.collection('seasons').select().get();
          for (const season of seasons.docs) {
            if (await exists(`seasons/${season.id}/standings/${uid}`)) return false;
          }
          return true;
        }
        default:
          if (source.id === 'storage.fans') {
            return (await bucket.getFiles({ prefix: `fans/${uid}/` }))[0].length === 0;
          }
          if (source.id === 'storage.fanClubMedia') {
            return (await bucket.getFiles({ prefix: `fanClubMedia/${uid}/` }))[0].length === 0;
          }
      }
    }
    if (effect === 'stripped' && source.id === 'fanClubs' && how.kind === 'equal') {
      // A lápide (decisão 21): encerrada, sem o dono, as cópias e o nome.
      const tomb = await read(`fanClubs/${known.clubId}`);
      return (
        (await none(db.collection(how.collection).where(how.field, '==', uid))) &&
        tomb?.ownerUid === null &&
        tomb.ownerName === null &&
        tomb.ownerUsername === null &&
        tomb.ownerPhotoURL === null &&
        tomb.name === null &&
        tomb.status === 'closed' &&
        tomb.statusReason === 'account_deleted' &&
        tomb.accountDeleted === true
      );
    }
    if (effect === 'stripped' && how.kind === 'equal') {
      const kept = await read(`${how.collection}/${known.redemptionId}`);
      return (
        (await none(db.collection(how.collection).where(how.field, '==', uid))) &&
        kept?.uid === null &&
        kept.accountDeleted === true
      );
    }
    if (effect === 'detached' && how.kind === 'count') {
      return (
        (await none(db.collection(how.collection).where(how.field, '==', uid))) &&
        (await read(`referrals/${known.inviteeUid}`))?.inviterUid === null
      );
    }
    if (effect === 'kept') {
      switch (source.id) {
        case 'inviterLedger': {
          const ledger = await db.collection(`wallets/${known.inviterUid}/ledger`).get();
          const withFan = ledger.docs.filter((doc) => doc.get('actor')?.uid === uid);
          return (
            withFan.map((doc) => doc.id).join() === known.inviterEntries.join() &&
            withFan.length > 0
          );
        }
        case 'moderationQueue': {
          // O item aberto vai a `author_deleted`, sem o texto.
          const items = await db.collection('moderationQueue').where('authorUid', '==', uid).get();
          return (
            !items.empty &&
            items.docs.every(
              (doc) => doc.get('commentText') === null && doc.get('status') === 'resolved',
            )
          );
        }
        case 'profileReportQueue': {
          // O item aberto vai a `author_deleted`, sem o resumo do perfil.
          const item = await read(`profileReportQueue/${uid}`);
          return item?.resolvedDigest === null && item.resolution === 'author_deleted';
        }
        case 'fanClubReportQueue': {
          // O item aberto da publicação dele vai a `author_deleted` (etapa 2).
          const items = await db
            .collection('fanClubReportQueue')
            .where('authorUid', '==', uid)
            .get();
          return (
            !items.empty &&
            items.docs.every(
              (doc) =>
                doc.get('status') === 'resolved' && doc.get('resolution') === 'author_deleted',
            )
          );
        }
        case 'fanClubs.prizes': {
          // O registro fica na lápide, sem dado dele (34.7), e o pedido de
          // prêmio aberto é cancelado sem o cupom e a mensagem.
          const prize = await read(`fanClubs/${known.clubId}/prizes/${known.grantId}`);
          const order = await read(`redemptions/${known.prizeCode}`);
          return (
            prize !== undefined &&
            !JSON.stringify(prize).includes(uid) &&
            order?.status === 'canceled' &&
            order.uid === null &&
            order.coupon === null &&
            order.message === null
          );
        }
        case 'staffAudit':
          return !(await none(db.collection('staffAudit').where('targetUid', '==', uid)));
        case 'accessLog':
          // No Cloud Logging, fora do emulador.
          return true;
      }
    }
    throw new Error(`Sem conferência da exclusão para a fonte ${source.id}.`);
  }
}

describe('o arquivo de um fã com dado em toda fonte, e a exclusão', () => {
  it(
    'exportado inteiro, sem dado de outra pessoa nem da equipe; a lista cobre as subcoleções; a exclusão trata cada fonte',
    async () => {
      const now = Date.now();
      const admin = await seedMember(env, 'Admin da Equipe', 'admin');
      const fan = await signUpFan(db, 'Camila Ribeiro');
      const inviter = await signUpFan(db, 'Duda Lima');
      const invitee = await signUpFan(db, 'Enzo Rocha');
      const other = await signUpFan(db, 'Bia Santos');
      const call = localApi(env, { now: () => Date.now() });
      const as = (who: Fan) => (method: string, path: string, body?: unknown) =>
        call(method, path, { token: who.token, key: unique('chave-dados-'), body });

      // A linha em duas temporadas fechadas, pelo núcleo do seed, antes de
      // qualquer ponto; e a foto, pelo núcleo do seed.
      expect(await seedPastSeasons(db, new Map(), fan.uid, { now })).toBe(true);
      expect(await seedFanPhoto(db, files, save, fan.uid, JPEG)).toBe('created');

      // A origem: o fã chega pelo código da Duda. O código dele, um link e o
      // Enzo trazido pelo código.
      const inviterCode = (await as(inviter)('GET', '/me/invite')).body.code as string;
      expect(await as(fan)('POST', '/invites/claim', codeBody(inviterCode))).toMatchObject({
        status: 200,
        body: { status: 'claimed' },
      });
      const code = (await as(fan)('GET', '/me/invite')).body.code as string;
      expect((await as(fan)('PUT', '/me/invite/links/agenda')).status).toBe(200);
      expect(await as(invitee)('POST', '/invites/claim', codeBody(code))).toMatchObject({
        status: 200,
        body: { status: 'claimed' },
      });

      // A central, a curtida, o "Eu vou" e três comentários.
      const artistId = await central(env);
      const postId = await post(env, artistId);
      const eventId = await show(env, [artistId], now + 10 * DAY_MS);
      // A Duda gere um fã-clube da central (seção 34): a entrada do fã, trazido
      // pelo código dela, é creditada (o `fanClubId` no vínculo, fora do
      // arquivo, e o marcador `fanClubCredits`, fora dele inteiro).
      await db.doc(`artistPrivate/${artistId}`).set({ imageRightsConfirmed: true });
      expect((await as(inviter)('PUT', `/me/centrals/${artistId}`)).status).toBe(200);
      const inviterApplied = await as(inviter)('POST', '/me/fan-club/application', {
        artistId,
        name: 'Turma da Duda',
        instagram: 'duda.teste.up',
        whatsapp: '(75) 99876-5432',
        pitch: 'Divulgo a central no grupo dos fãs da cidade e nos stories.',
        adult: true,
        rulesVersion: FAN_CLUB_RULES_VERSION,
      });
      expect(inviterApplied.status).toBe(200);
      await ok(
        'decideFanClub',
        { subject: 'application', id: inviter.uid, decision: 'approve', expected: 1 },
        admin,
      );
      const inviterClubId = (await read(`fanClubApplications/${inviter.uid}`))?.clubId as string;
      expect(inviterClubId).toEqual(expect.any(String));
      expect((await as(fan)('PUT', `/me/centrals/${artistId}`)).status).toBe(200);
      expect(await read(`users/${fan.uid}/centrals/${artistId}`)).toMatchObject({
        firstJoin: true,
        fanClubId: inviterClubId,
      });
      expect(await read(`users/${fan.uid}/fanClubCredits/${artistId}`)).toMatchObject({
        clubId: inviterClubId,
        via: 'owner_code',
      });
      // O fã segue o fã-clube da Duda (etapa 4): o vínculo vai ao arquivo sem o
      // `byOwnerCode` (diria quem convidou), e sai na exclusão.
      expect(await as(fan)('PUT', `/me/fan-club-follows/${inviterClubId}`)).toMatchObject({
        status: 200,
        body: { following: true, joined: false },
      });
      expect(await read(`users/${fan.uid}/fanClubFollows/${inviterClubId}`)).toMatchObject({
        byOwnerCode: true,
      });
      expect((await as(fan)('PUT', `/posts/${postId}/like`)).status).toBe(200);
      expect((await as(fan)('PUT', `/events/${eventId}/rsvp`)).status).toBe(200);
      const commentIds: string[] = [];
      for (const text of ['Que show!', 'Sigam meu perfil', 'Arrocha demais']) {
        const result = await as(fan)('POST', `/posts/${postId}/comments`, { text });
        expect(result.status).toBe(200);
        commentIds.push(result.body.id as string);
      }
      const otherComment = await as(other)('POST', `/posts/${postId}/comments`, {
        text: 'Bom demais',
      });
      expect(otherComment.status).toBe(200);

      // As denúncias contra o fã (fora do arquivo), as dele e o bloqueio.
      const report = (who: Fan, path: string) => as(who)('POST', path, { reason: 'spam' });
      expect(
        (await report(other, `/posts/${postId}/comments/${commentIds[2]}/report`)).status,
      ).toBe(200);
      expect((await report(other, `/fans/${fan.uid}/report`)).status).toBe(200);
      expect(
        (await report(fan, `/posts/${postId}/comments/${String(otherComment.body.id)}/report`))
          .status,
      ).toBe(200);
      expect((await report(fan, `/fans/${other.uid}/report`)).status).toBe(200);
      expect((await as(fan)('PUT', `/me/blocks/${other.uid}`)).status).toBe(200);

      // O fã-clube (seção 34): a candidatura na central, aprovada pela equipe.
      // O privado fica com as redes (o texto de divulgação sai na aprovação).
      const applied = await as(fan)('POST', '/me/fan-club/application', {
        artistId,
        name: 'Turma da Camila',
        instagram: 'camila.teste.up',
        // O contato do fã nasce aqui (source fanclub), e o resgate depois o regrava.
        whatsapp: '(75) 99123-4567',
        pitch: 'Divulgo a central nos stories e no grupo dos fãs da cidade.',
        adult: true,
        rulesVersion: FAN_CLUB_RULES_VERSION,
      });
      expect(applied).toMatchObject({ status: 200, body: { application: { status: 'pending' } } });
      await ok(
        'decideFanClub',
        { subject: 'application', id: fan.uid, decision: 'approve', expected: 1 },
        admin,
      );
      const clubId = (await read(`fanClubApplications/${fan.uid}`))?.clubId as string;
      expect(clubId).toEqual(expect.any(String));

      // A publicação com foto (etapa 2): a vaga, os dois arquivos, a aprovação
      // da equipe (o `reviewedBy` fica fora do arquivo) e a denúncia de outro
      // fã contra ela (fora do arquivo, fica na exclusão).
      const slot = (await as(fan)('POST', '/me/fan-club/upload')).body as {
        photoPath: string;
        thumbPath: string;
      };
      await save(slot.photoPath, JPEG);
      await save(slot.thumbPath, JPEG);
      const published = await as(fan)('POST', '/me/fan-club/posts', {
        text: 'Foto do ensaio',
        photo: true,
      });
      expect(published).toMatchObject({ status: 200, body: { status: 'pending', kind: 'photo' } });
      const fanClubPostId = published.body.id as string;
      await ok(
        'decideFanClub',
        { subject: 'post', id: fanClubPostId, decision: 'approve', expected: 'pending' },
        admin,
      );
      expect((await report(other, `/fan-club-posts/${fanClubPostId}/report`)).status).toBe(200);
      // A denúncia dele numa publicação no ar de outro fã-clube.
      const otherClubPost = unique('pubOutro');
      await db.doc(`fanClubPosts/${otherClubPost}`).set({
        clubId: 'clubeDoOutro',
        artistId,
        authorUid: other.uid,
        authorName: 'Bia Santos',
        authorUsername: null,
        authorPhotoURL: null,
        kind: 'text',
        text: 'Do outro fã-clube',
        media: null,
        status: 'published',
        rejectReason: null,
        submittedAt: Timestamp.fromMillis(now),
        publishedAt: Timestamp.fromMillis(now),
        reviewedAt: null,
        reviewedBy: null,
        schemaVersion: 1,
      });
      expect((await report(fan, `/fan-club-posts/${otherClubPost}/report`)).status).toBe(200);

      // A equipe: um ajuste, um pedido recusado e um comentário ocultado.
      await ok(
        'adjustFanPoints',
        { uid: fan.uid, adjustmentId: unique('ajuste-'), note: 'Correção do show', balance: 100 },
        admin,
      );
      const { rewardId } = await ok<{ rewardId: string }>(
        'createReward',
        {
          kind: 'ticket',
          title: 'Par de ingressos',
          subtitle: 'Pra Encher e Derramar',
          cost: 50,
          instructions: 'Retire na bilheteria com este código.',
        },
        admin,
      );
      await ok('setRewardStatus', { rewardId, status: 'published' }, admin);
      const redeemed = await as(fan)('POST', `/rewards/${rewardId}/redeem`, {
        expectedCost: 50,
        whatsapp: '(75) 99123-4567',
      });
      expect(redeemed.status).toBe(200);
      const redemptionId = redeemed.body.code as string;
      await ok(
        'setRedemptionStatus',
        { redemptionId, status: 'refused', reason: 'Fora do prazo' },
        admin,
      );
      await ok('moderateComment', { postId, commentId: commentIds[1], action: 'hide' }, admin);

      // O prêmio do fã-clube (etapa 5): os pontos no extrato (sem a nota da
      // equipe) e o pedido de prêmio aberto, com o cupom e a mensagem, dele.
      const prizeReward = await ok<{ rewardId: string }>(
        'createReward',
        {
          prize: true,
          kind: 'discount',
          title: 'Desconto na loja parceira',
          subtitle: 'Só para prêmios',
          cost: 0,
          stockTotal: 5,
          instructions: 'Use o cupom no site da loja parceira.',
        },
        admin,
      );
      const grantId = unique('concessao-dados-');
      const granted = await ok<{ code: string }>(
        'decideFanClub',
        {
          subject: 'club',
          id: clubId,
          decision: 'reward',
          expected: 'active',
          grantId,
          points: 200,
          prize: {
            rewardId: prizeReward.rewardId,
            delivered: false,
            coupon: 'CUPOM-DA-CAMILA',
            message: 'Parabéns pelo fã-clube!',
          },
          note: 'Nota interna do prêmio',
        },
        admin,
      );
      const prizeCode = granted.code;
      expect(prizeCode).toEqual(expect.stringMatching(/^UP-/));

      // 501 lançamentos gravados pelo Admin SDK: o extrato passa de uma página.
      for (let start = 0; start < 501; start += 250) {
        const batch = db.batch();
        for (let n = start; n < Math.min(start + 250, 501); n += 1) {
          const id = `seed:extra-${String(n).padStart(4, '0')}`;
          batch.set(db.doc(`wallets/${fan.uid}/ledger/${id}`), {
            uid: fan.uid,
            kind: 'earn',
            source: 'seed',
            eventId: id.slice('seed:'.length),
            points: 0,
            actor: { type: 'system', uid: null, name: null },
            createdAt: Timestamp.fromMillis(now),
          });
        }
        await batch.commit();
      }

      const { start, file, pages } = await exportAll(admin, fan);

      // O começo, na ordem de 32.3, e as 8 partes.
      expect(Object.keys(start)).toEqual([
        'formato',
        'versao',
        'geradoEm',
        'uid',
        'avisos',
        ...FAN_DATA_FIRST_KEYS,
        'partes',
      ]);
      expect(start).toMatchObject({ formato: 'imagineup-dados-do-fa', versao: 1, uid: fan.uid });
      expect(start.partes).toEqual([...FAN_DATA_PARTS]);
      expect(file.conta).toEqual({
        nome: 'Camila Ribeiro',
        email: fan.email,
        emailConfirmado: false,
        provedores: [{ id: 'password', email: fan.email }],
        criadaEm: expect.stringMatching(/Z$/),
        ultimoLoginEm: expect.stringMatching(/Z$/),
      });
      const profile = file.perfil as Item;
      for (const field of ['searchKeys', 'signupCounted', 'photoPath']) {
        expect(profile, field).not.toHaveProperty(field);
      }
      expect(profile.photoURL).toEqual(expect.any(String));
      // O contato do fã (seção 35), inteiro, com a origem e a data.
      expect(file.contato).toEqual({
        whatsapp: '+5575991234567',
        source: 'store',
        updatedAt: expect.stringMatching(/Z$/),
      });
      expect(file.pessoasTrazidas).toBe(1);
      expect(file.origem as Item).toMatchObject({ code: inviterCode });
      for (const field of ['inviterUid', 'award', 'inviterRemovedAt']) {
        expect(file.origem as Item, field).not.toHaveProperty(field);
      }
      expect((file.temporadas as Item[]).map((row) => row.id).sort()).toEqual(
        (await db.collection('seasons').select().get()).docs.map((doc) => doc.id).sort(),
      );

      // Cada fonte com lugar no arquivo vem não vazia.
      for (const source of FAN_DATA_SOURCES) {
        const { place } = source;
        if (place.in === 'out') continue;
        const value = file[place.in === 'part' ? place.part : place.key];
        expect(value, source.id).not.toBeNull();
        expect(value, source.id).not.toBeUndefined();
        if (Array.isArray(value)) expect(value.length, source.id).toBeGreaterThan(0);
        if (typeof value === 'number') expect(value, source.id).toBeGreaterThan(0);
        if (place.in === 'address') {
          // A foto do perfil no `photoURL`; as das publicações, na `media` da primeira.
          const holder = (Array.isArray(value) ? value[0] : value) as Item;
          expect(JSON.stringify(holder[place.field]), source.id).toMatch(/token=/);
        }
      }

      // O extrato em duas páginas, com o `after` de verdade devolvido como veio.
      const ledgerIds = (
        await db.collection(`wallets/${fan.uid}/ledger`).orderBy(FieldPath.documentId()).get()
      ).docs.map((doc) => doc.id);
      expect(ledgerIds.length).toBeGreaterThan(501);
      const [first, second] = pages.extrato!;
      expect(pages.extrato).toHaveLength(2);
      expect(first!.items).toHaveLength(500);
      expect(first!.after).toBe(ledgerIds[499]);
      expect(second!.items).toHaveLength(ledgerIds.length - 500);
      expect(second!.after).toBeNull();
      const masked = (id: string) =>
        id.startsWith('invite_visit:')
          ? 'invite_visit'
          : id.startsWith('invite_signup:')
            ? 'invite_signup'
            : id;
      expect((file.extrato as Item[]).map((item) => item.id)).toEqual(ledgerIds.map(masked));
      for (const item of file.extrato as Item[]) {
        expect(item).not.toHaveProperty('uid');
        if (item.actor !== undefined) expect(Object.keys(item.actor as Item)).toEqual(['type']);
      }

      // Os comentários: o `postId` pelo caminho, sem o `hiddenBy`, e o cursor
      // pelo caminho completo.
      const commentPaths = (
        await db
          .collectionGroup('postComments')
          .where('authorUid', '==', fan.uid)
          .orderBy(FieldPath.documentId())
          .get()
      ).docs.map((doc) => doc.ref.path);
      expect(commentPaths).toHaveLength(3);
      expect(file.comentarios as Item[]).toHaveLength(3);
      for (const item of file.comentarios as Item[]) {
        expect(item.postId).toBe(postId);
        expect(item).not.toHaveProperty('hiddenBy');
      }
      const rest = await ok<ExportPage>(
        'exportFanData',
        { uid: fan.uid, part: 'comentarios', after: commentPaths[0] },
        admin,
      );
      expect(rest.items.map((item) => (item as Item).id)).toEqual(
        commentPaths.slice(1).map((path) => path.split('/')[3]),
      );
      expect(rest.after).toBeNull();
      // O vínculo com a central leva o `firstJoin`, e não o `fanClubId` (diria
      // quem convidou, seção 34, 34.7); o marcador do crédito fica fora.
      expect(file.centrais as Item[]).toEqual([
        expect.objectContaining({ id: artistId, firstJoin: true }),
      ]);
      expect((file.centrais as Item[])[0]).not.toHaveProperty('fanClubId');
      // Os pedidos sem quem da equipe mudou; o de prêmio (etapa 5) com o cupom,
      // a mensagem e o fã-clube, que são dele.
      expect(file.pedidosDaLoja as Item[]).toHaveLength(2);
      for (const item of file.pedidosDaLoja as Item[]) expect(item).not.toHaveProperty('updatedBy');
      expect(file.pedidosDaLoja as Item[]).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: prizeCode,
            origin: 'prize',
            coupon: 'CUPOM-DA-CAMILA',
            message: 'Parabéns pelo fã-clube!',
            fanClubId: clubId,
            points: 0,
          }),
        ]),
      );
      // O fã-clube (34.7): a candidatura sem quem decidiu, o privado com as
      // redes e sem o texto de divulgação, e o fã-clube sem quem aprovou.
      expect(file.candidaturaDeFaClube as Item).toMatchObject({
        status: 'approved',
        clubId,
        proposedName: 'Turma da Camila',
      });
      expect(file.candidaturaDeFaClube as Item).not.toHaveProperty('decidedBy');
      expect(file.candidaturaDeFaClubePrivada as Item).toMatchObject({
        instagram: 'camila.teste.up',
        pitch: null,
      });
      expect(file.faClubes as Item[]).toEqual([
        expect.objectContaining({ id: clubId, name: 'Turma da Camila', status: 'active' }),
      ]);
      expect((file.faClubes as Item[])[0]).not.toHaveProperty('approvedBy');
      // As publicações (etapa 2), sem quem revisou, e a denúncia dele, sem a rodada.
      expect(file.publicacoesDeFaClube as Item[]).toEqual([
        expect.objectContaining({ id: fanClubPostId, status: 'published', text: 'Foto do ensaio' }),
      ]);
      expect((file.publicacoesDeFaClube as Item[])[0]).not.toHaveProperty('reviewedBy');
      expect(file.denunciasDeFaClube as Item[]).toEqual([
        expect.objectContaining({ postId: otherClubPost, reason: 'spam' }),
      ]);
      expect((file.denunciasDeFaClube as Item[])[0]).not.toHaveProperty('round');
      // Os fã-clubes que ele segue (etapa 4), sem o `byOwnerCode`.
      expect(file.faClubesSeguidos as Item[]).toEqual([
        expect.objectContaining({
          id: inviterClubId,
          clubId: inviterClubId,
          artistId,
          newAccount: true,
          chosenUsername: true,
        }),
      ]);
      expect((file.faClubesSeguidos as Item[])[0]).not.toHaveProperty('byOwnerCode');

      // Nada de outra pessoa (pergunta 7: os alvos das denúncias e dos
      // bloqueios ficam) e nada da equipe, da chave do convidado ou do ownerKey.
      const text = JSON.stringify(file);
      const withoutTargets = JSON.stringify({
        ...file,
        denunciasDeComentario: null,
        denunciasDePerfil: null,
        bloqueios: null,
      });
      for (const someone of [inviter, invitee, other]) {
        expect(withoutTargets).not.toContain(someone.uid);
      }
      expect(JSON.stringify(file.bloqueios)).toContain(other.uid);
      expect(JSON.stringify(file.denunciasDePerfil)).toContain(other.uid);
      expect(text).not.toContain(admin.uid);
      expect(text).not.toContain('Admin da Equipe');
      expect(text).not.toContain(personKey(invitee.email, invitee.uid, EMULATOR_INVITE_KEY));
      const ownerKey = (await read(`inviteCodes/${code}`))?.ownerKey as string;
      expect(ownerKey).toEqual(expect.any(String));
      expect(text).not.toContain(ownerKey);
      // O fã chegou pelo código digitado, sem link: o id do fã-clube da Duda só
      // estaria no `fanClubId` do vínculo, que sai. Pelo link `/fa-clube/<id>`,
      // ele iria na `origem.link.targetId`, de propósito (34.22). Ele segue o
      // fã-clube da Duda: o id vai nos seguidos, porque seguir é dele, e sem o
      // `byOwnerCode` nada ali diz quem convidou.
      expect(JSON.stringify({ ...file, faClubesSeguidos: null })).not.toContain(inviterClubId);
      // Os lançamentos que a equipe mexeu estão lá, sem quem mexeu.
      expect((file.extrato as Item[]).map((item) => item.source)).toEqual(
        expect.arrayContaining([
          'adjustment',
          'redeem',
          'redeem_refund',
          'invite_visit',
          'invite_signup',
          'fanclub_prize',
        ]),
      );
      // O motivo do ajuste fica fora: o painel diz a quem ajusta que o fã não o vê.
      const adjustment = (file.extrato as Item[]).find((item) => item.source === 'adjustment');
      expect(adjustment).toBeDefined();
      expect(adjustment).not.toHaveProperty('note');
      expect(text).not.toContain('Correção do show');
      // A nota interna do prêmio também (o registro `prizes` fica fora do arquivo).
      const prizeEntry = (file.extrato as Item[]).find((item) => item.source === 'fanclub_prize');
      expect(prizeEntry).toMatchObject({ id: `fanclub_prize:${grantId}`, points: 200 });
      expect(prizeEntry).not.toHaveProperty('note');
      expect(text).not.toContain('Nota interna do prêmio');

      // A ponta do "dado novo": as subcoleções dos documentos do fã estão na lista.
      for (const parent of FAN_DATA_PARENTS) {
        const names = (await db.doc(`${parent}/${fan.uid}`).listCollections()).map(
          (collection) => collection.id,
        );
        expect(names.length, parent).toBeGreaterThan(0);
        expect(
          names.filter((name) => !knownSubcollections(parent).includes(name)),
          parent,
        ).toEqual([]);
      }

      // A exclusão: a conta sai, e o gatilho trata cada fonte como a lista diz.
      const inviterEntries = (await db.collection(`wallets/${inviter.uid}/ledger`).get()).docs
        .filter((doc) => doc.get('actor')?.uid === fan.uid)
        .map((doc) => doc.id);
      expect(inviterEntries.length).toBeGreaterThan(0);
      const known = {
        redemptionId,
        inviteeUid: invitee.uid,
        inviterUid: inviter.uid,
        inviterEntries,
        clubId,
        grantId,
        prizeCode,
      };
      expect(await ok('deleteFanAccount', request(fan), admin)).toEqual({ status: 'deleted' });
      await waitFor(
        'o gatilho da exclusão tratar cada fonte',
        async () => (await leftovers(fan.uid, known)).length === 0,
        90_000,
      );
      expect(await leftovers(fan.uid, known)).toEqual([]);
      // Quem segue sai junto: o `count()` dos seguidores cai, sem passo novo.
      const followers = await db
        .collectionGroup('fanClubFollows')
        .where('clubId', '==', inviterClubId)
        .count()
        .get();
      expect(followers.data().count).toBe(0);

      // De novo, depois do gatilho: sem conta e sem perfil.
      expect((await failure('deleteFanAccount', request(fan), admin)).details?.reason).toBe(
        'fan-not-found',
      );
      expect((await failure('exportFanData', request(fan), admin)).details?.reason).toBe(
        'fan-not-found',
      );
    },
    LONG_MS,
  );

  it('a origem sem o pagamento nem a saída de quem convidou: suspensa, e com a conta excluída', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const call = localApi(env, { now: () => Date.now() });
    const as = (who: Fan) => (method: string, path: string, body?: unknown) =>
      call(method, path, { token: who.token, key: unique('chave-origem-'), body });
    const codeOf = async (who: Fan) => (await as(who)('GET', '/me/invite')).body.code as string;
    const suspended = await signUpFan(db, 'Duda Lima');
    const removed = await signUpFan(db, 'Enzo Rocha');
    const suspendedCode = await codeOf(suspended);
    const removedCode = await codeOf(removed);
    await db.doc(`users/${suspended.uid}`).update({ suspendedAt: Timestamp.now() });
    const invited = [
      { fan: await signUpFan(db, 'Camila Ribeiro'), code: suspendedCode },
      { fan: await signUpFan(db, 'Bia Santos'), code: removedCode },
    ];
    for (const { fan, code } of invited) {
      expect(await as(fan)('POST', '/invites/claim', codeBody(code))).toMatchObject({
        status: 200,
        body: { status: 'claimed' },
      });
    }
    // Com quem convidou suspensa, o pagamento a ela sai `skipped`; com a conta
    // dela excluída, o gatilho grava o `inviterRemovedAt` na origem.
    expect((await read(`referrals/${invited[0]!.fan.uid}`))?.award).toEqual({
      visit: 'skipped',
      signup: 'skipped',
    });
    await auth.deleteUser(removed.uid);
    await waitFor(
      'o gatilho desligar a origem de quem foi convidado',
      async () =>
        (await read(`referrals/${invited[1]!.fan.uid}`))?.inviterRemovedAt instanceof Timestamp,
      60_000,
    );

    for (const { fan, code } of invited) {
      const start = await ok<ExportStart>('exportFanData', request(fan), admin);
      expect(start.origem as Item, fan.uid).toMatchObject({ uid: fan.uid, code });
      for (const field of ['inviterUid', 'award', 'inviterRemovedAt']) {
        expect(start.origem as Item, `${fan.uid} ${field}`).not.toHaveProperty(field);
      }
    }
  });

  it('as 1.001 denúncias de comentário, de dias diferentes, vêm todas na primeira chamada', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    const fan = await signUpFan(db, 'Camila Ribeiro');
    const base = Date.now() - 1_001 * DAY_MS;
    const ids: string[] = [];
    for (let start = 0; start < 1_001; start += 500) {
      const batch = db.batch();
      for (let n = start; n < Math.min(start + 500, 1_001); n += 1) {
        const id = `denuncia-${String(n).padStart(4, '0')}`;
        const at = base + n * DAY_MS;
        ids.push(id);
        batch.set(db.doc(`commentReports/${id}`), {
          postId: 'p-clipe',
          commentId: `c${n}`,
          commentAuthorUid: 'outroFa',
          reporterUid: fan.uid,
          reason: 'spam',
          day: dayKey(at),
          createdAt: Timestamp.fromMillis(at),
          schemaVersion: 1,
        });
      }
      await batch.commit();
    }
    const start = await ok<ExportStart>('exportFanData', request(fan), admin);
    const reports = start.denunciasDeComentario as Item[];
    expect(reports).toHaveLength(1_001);
    expect(reports.map((item) => item.id)).toEqual(ids);
    expect(new Set(reports.map((item) => item.day)).size).toBe(1_001);
  });
});

describe('os casos de borda da exclusão', () => {
  it('fan-is-staff com o staff/{uid} ativo, pendente e desativado; o fã da equipe exporta', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');
    for (const status of ['active', 'pending', 'disabled'] as const) {
      const fan = await staffFan(status);
      const refused = await failure('deleteFanAccount', request(fan), admin);
      expect(refused.details, status).toEqual({ reason: 'fan-is-staff' });
      expect(refused.message).toBe(
        'Esta conta também é da equipe do painel. Tire a pessoa da Equipe antes de excluir a conta.',
      );
      expect((await auth.getUser(fan.uid)).uid).toBe(fan.uid);
      expect(await exists(`users/${fan.uid}`)).toBe(true);
      if (status === 'active') {
        expect(await ok('exportFanData', request(fan), admin)).toMatchObject({ uid: fan.uid });
      }
    }
    expect(await audits('fan.account.deleted')).toEqual([]);
    expect((await limitOf(admin.uid))?.deletedUids).toEqual([]);
  });

  it('a conta do Auth sem perfil é excluída; o perfil sem conta responde pending, sem teto nem auditoria', async () => {
    const admin = await seedMember(env, 'Admin', 'admin');

    const accountOnly = await signUpFan(db, 'Conta Sem Perfil');
    await db.doc(`users/${accountOnly.uid}`).delete();
    expect(await ok('deleteFanAccount', request(accountOnly), admin)).toEqual({
      status: 'deleted',
    });
    await expect(auth.getUser(accountOnly.uid)).rejects.toMatchObject({
      code: 'auth/user-not-found',
    });
    expect(await audits('fan.account.deleted')).toHaveLength(1);

    const orphan = unique('perfilSemConta');
    await db.doc(`users/${orphan}`).set({
      displayName: 'Perfil Sem Conta',
      username: orphan.toLowerCase(),
      createdAt: Timestamp.now(),
    });
    expect(
      await ok('deleteFanAccount', { uid: orphan, email: 'qualquer@teste.dev' }, admin),
    ).toEqual({ status: 'pending' });
    expect(
      (await failure('exportFanData', { uid: orphan, email: 'x@teste.dev' }, admin)).details,
    ).toEqual({ reason: 'fan-not-found' });
    expect(await audits('fan.account.deleted')).toHaveLength(1);
    expect((await limitOf(admin.uid))?.deletedUids).toEqual([accountOnly.uid]);
  });
});
