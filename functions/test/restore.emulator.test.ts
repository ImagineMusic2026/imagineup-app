import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  DocumentReference,
  getFirestore,
  Timestamp,
  type Firestore,
} from 'firebase-admin/firestore';
import { beforeEach, describe, expect, it } from 'vitest';

import { FAN_DATA_SOURCES } from '../src/fan-data';
import {
  applyRestore,
  planRestore,
  reexclusionStart,
  RESTORE_MARK,
  restoreFromCopy,
  type RestoreReport,
} from '../src/restore';
import {
  callable,
  central,
  localApi,
  post,
  PROJECT_ID,
  RESET_TIMEOUT_MS,
  seedMember,
  signUpFan,
  unique,
  useEmulators,
  waitFor,
  type Fan,
  type Member,
} from './support';

/**
 * O roteiro de restauração (docs/arquitetura-api.md, 31.3): a cópia é um
 * banco `recuperacao-...` do emulador, montado como o clone faria (todos os
 * documentos do (default) naquele instante). A conta que sai depois da cópia
 * passa pelo gatilho de verdade (`deleteUserProfile`), e o roteiro não a
 * traz de volta, nem o que a exclusão mudou nos dados dos outros; as
 * contagens do (default) ficam como estão; o --dry-run não grava no
 * (default); o diferente só volta com --overwrite, e o perfil com outra
 * foto, nunca; e o script de verdade, com as recusas da linha de comando.
 */
const env = useEmulators('restauracao', [
  'createUserProfile',
  'deleteUserProfile',
  'adjustFanPoints',
  'createReward',
  'setRewardStatus',
  'queueArtistFanCountSync',
  'syncArtistFanCount',
  'queuePostCountSync',
  'syncPostCounts',
]);
const { app, db, auth } = env;

const COPY = 'recuperacao-teste';
const copy = getFirestore(app, COPY);
/** Prazo dos testes que montam os fãs e esperam o gatilho da exclusão. */
const LONG_MS = 240_000;
const SCRIPT = resolve(__dirname, '../../scripts/restore-from-copy.mjs');

/** Limpa o banco da cópia, como o `resetEmulators` limpa o (default). */
async function resetCopy(): Promise<void> {
  const response = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/${COPY}/documents`,
    { method: 'DELETE' },
  );
  if (!response.ok) throw new Error(`O emulador não limpou a cópia: ${response.status}`);
}
beforeEach(resetCopy, RESET_TIMEOUT_MS);

/** Os documentos de um banco, nível por nível (com os que só têm subcoleções). */
async function allDocuments(from: Firestore): Promise<DocumentReference[]> {
  const out: DocumentReference[] = [];
  let level = (
    await Promise.all((await from.listCollections()).map((c) => c.listDocuments()))
  ).flat();
  while (level.length > 0) {
    out.push(...level);
    const next: DocumentReference[] = [];
    for (const ref of level) {
      for (const collection of await ref.listCollections()) {
        next.push(...(await collection.listDocuments()));
      }
    }
    level = next;
  }
  return out;
}

/** A cópia como o `gcloud firestore databases clone` deixaria: todo documento do (default) agora. */
async function cloneDefault(): Promise<number> {
  const refs = await allDocuments(db);
  const writer = copy.bulkWriter();
  let copied = 0;
  for (let start = 0; start < refs.length; start += 300) {
    for (const snap of await db.getAll(...refs.slice(start, start + 300))) {
      if (!snap.exists) continue;
      void writer.set(copy.doc(snap.ref.path), snap.data()!);
      copied += 1;
    }
  }
  await writer.close();
  return copied;
}

const exists = async (from: Firestore, path: string) => (await from.doc(path).get()).exists;
const read = async (from: Firestore, path: string) => (await from.doc(path).get()).data();

async function ok<T = Record<string, unknown>>(name: string, data: unknown, who: Member) {
  const { result, error } = await callable<T>(env, name, data, who.token);
  if (error) {
    throw new Error(`${name} falhou: ${error.status} ${error.details?.reason} ${error.message}`);
  }
  return result as T;
}

/** Soma de um campo nos shards de uma subcoleção. */
async function shardSum(path: string, field: string): Promise<number> {
  const snap = await db.collection(path).get();
  return snap.docs.reduce((total, doc) => total + Number(doc.get(field) ?? 0), 0);
}

/**
 * As fontes da `FAN_DATA_SOURCES` que a exclusão apaga e ainda têm dado do
 * fã num banco (o (default) ou a cópia). Vazio: nada dele voltaria.
 */
async function deletedSourcesWithData(from: Firestore, uid: string): Promise<string[]> {
  const left: string[] = [];
  for (const source of FAN_DATA_SOURCES) {
    if (source.deletion.effect !== 'deleted') continue;
    const how = source.read;
    let found = false;
    switch (how.kind) {
      case 'doc':
        found = await exists(from, `${how.collection}/${uid}`);
        break;
      case 'sub':
        found = !(await from.collection(`${how.parent}/${uid}/${how.name}`).limit(1).get()).empty;
        break;
      case 'subdoc':
        found = await exists(from, `${how.parent}/${uid}/${how.name}/${how.id}`);
        break;
      case 'equal':
        found = !(await from.collection(how.collection).where(how.field, '==', uid).limit(1).get())
          .empty;
        break;
      case 'group':
        found = !(await from.collectionGroup(how.group).where(how.field, '==', uid).limit(1).get())
          .empty;
        break;
      case 'standings':
        found = !(await from.collectionGroup('standings').get()).docs.every(
          (doc) => doc.id !== uid,
        );
        break;
      default:
        break;
    }
    if (found) left.push(source.id);
  }
  return left;
}

const kinds = (report: RestoreReport) =>
  Object.fromEntries(report.items.map((item) => [item.path, item.kind]));
const countOf = (report: RestoreReport, kind: string) =>
  report.items.filter((item) => item.kind === kind).length;

/** As coleções que o "script errado" do teste apaga do (default), e o roteiro traz de volta. */
const WIPED = [
  'users',
  'wallets',
  'fanInvites',
  'inviteCodes',
  'referrals',
  'usernames',
  'redemptions',
  'blockLists',
  'commentReports',
  'profileReports',
  'moderationQueue',
  'profileReportQueue',
  'idempotency',
];

describe('a conta excluída depois da cópia', () => {
  it(
    'o --dry-run tira a conta da cópia e não grava no (default); a rodada traz o resto de volta, sem nada dela e com os dados dos outros como a exclusão deixou',
    async () => {
      const admin = await seedMember(env, 'Admin da Equipe', 'admin');
      const fica = await signUpFan(db, 'Camila Fica');
      const sai = await signUpFan(db, 'Duda Sai');
      const outro = await signUpFan(db, 'Bia Outra');
      const trazido = await signUpFan(db, 'Enzo Trazido');
      const call = localApi(env, { now: () => Date.now() });
      const as = (who: Fan) => (method: string, path: string, body?: unknown) =>
        call(method, path, { token: who.token, key: unique('chave-restauracao-'), body });
      const expectOk = async (result: Promise<{ status: number }>) =>
        expect((await result).status).toBe(200);
      const codeBody = (code: string) => ({ code, via: 'code', link: null, openedAt: null });

      // A Duda chega pelo código da Camila e traz o Enzo pelo dela.
      const ficaCode = (await as(fica)('GET', '/me/invite')).body.code as string;
      await expectOk(as(sai)('POST', '/invites/claim', codeBody(ficaCode)));
      const saiCode = (await as(sai)('GET', '/me/invite')).body.code as string;
      await expectOk(as(trazido)('POST', '/invites/claim', codeBody(saiCode)));

      // A central, a curtida e o comentário de cada uma; a Bia denuncia o
      // comentário e o perfil da Duda e bloqueia a Duda; a Duda bloqueia a Bia.
      const artistId = await central(env);
      const postId = await post(env, artistId);
      for (const fan of [fica, sai, outro]) {
        await expectOk(as(fan)('PUT', `/me/centrals/${artistId}`));
        await expectOk(as(fan)('PUT', `/posts/${postId}/like`));
      }
      const commented = await as(sai)('POST', `/posts/${postId}/comments`, { text: 'Que show!' });
      expect(commented.status).toBe(200);
      const saiComment = commented.body.id as string;
      await expectOk(as(fica)('POST', `/posts/${postId}/comments`, { text: 'Arrocha demais' }));
      await expectOk(
        as(outro)('POST', `/posts/${postId}/comments/${saiComment}/report`, { reason: 'spam' }),
      );
      await expectOk(as(outro)('POST', `/fans/${sai.uid}/report`, { reason: 'spam' }));
      await expectOk(as(outro)('PUT', `/me/blocks/${sai.uid}`));
      await expectOk(as(sai)('PUT', `/me/blocks/${outro.uid}`));

      // Um pedido da loja aberto da Duda.
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
      await ok(
        'adjustFanPoints',
        { uid: sai.uid, adjustmentId: unique('ajuste-'), note: 'Teste', balance: 100 },
        admin,
      );
      // Com o WhatsApp (seção 35): o contato de quem sai também não pode voltar.
      const redeemed = await as(sai)('POST', `/rewards/${rewardId}/redeem`, {
        expectedCost: 50,
        whatsapp: '(75) 99123-4567',
      });
      expect(redeemed.status).toBe(200);
      const redemptionId = redeemed.body.code as string;

      // A cópia, e depois dela a Duda exclui a conta: o gatilho de verdade.
      expect(await cloneDefault()).toBeGreaterThan(0);
      expect(await exists(copy, `users/${sai.uid}`)).toBe(true);
      expect(await exists(copy, `users/${sai.uid}/contact/main`)).toBe(true);
      await auth.deleteUser(sai.uid);
      await waitFor(
        'o gatilho da exclusão terminar',
        async () =>
          (await deletedSourcesWithData(db, sai.uid)).length === 0 &&
          (await read(db, `referrals/${trazido.uid}`))?.inviterUid === null &&
          (await read(db, `redemptions/${redemptionId}`))?.uid === null,
        90_000,
      );
      const fans = await shardSum(`artistStats/${artistId}/fanShards`, 'count');
      const posts = await shardSum(`postStats/${postId}/countShards`, 'likes');
      expect(fans).toBe(2);
      expect(posts).toBe(2);

      // O script errado: apaga as coleções dos fãs e os comentários do post.
      for (const collection of WIPED) await db.recursiveDelete(db.collection(collection));
      await db.recursiveDelete(db.collection(`posts/${postId}/postComments`));
      const paths = [...WIPED, `posts/${postId}/postComments`];
      const deps = { copy, target: db, auth };

      // --dry-run: a Duda sai da cópia, e nada é gravado no (default).
      const dry = await restoreFromCopy(deps, { paths, overwrite: false, dryRun: true });
      expect(dry.reexcluded).toEqual([sai.uid]);
      expect(dry.accounts).toBeGreaterThanOrEqual(4);
      expect(dry.written).toBeNull();
      expect(countOf(dry, 'create')).toBe(dry.items.length);
      expect(dry.items.map((item) => item.path)).toContain(`users/${fica.uid}`);
      // Com o uid da Duda no caminho, só o que é contra ela e fica (de quem denunciou).
      expect(
        dry.items
          .filter((item) => item.path.includes(sai.uid))
          .map((item) => item.path.split('/')[0])
          .sort(),
      ).toEqual(['profileReportQueue', 'profileReports']);
      expect(await deletedSourcesWithData(copy, sai.uid)).toEqual([]);
      for (const collection of WIPED) {
        expect((await db.collection(collection).limit(1).get()).empty, collection).toBe(true);
      }

      // A rodada de verdade: grava o que o --dry-run listou.
      const run = await restoreFromCopy(deps, { paths, overwrite: false, dryRun: false });
      expect(run.items).toEqual(dry.items);
      expect(run.written).toEqual({ created: dry.items.length, replaced: 0 });
      expect(run.changed).toEqual([]);
      expect(run.late).toEqual([]);

      // Os outros voltam inteiros; da Duda, nada.
      for (const fan of [fica, outro, trazido]) {
        expect(await exists(db, `users/${fan.uid}`), fan.uid).toBe(true);
        expect(await exists(db, `wallets/${fan.uid}`), fan.uid).toBe(true);
      }
      expect(await exists(db, `users/${fica.uid}/centrals/${artistId}`)).toBe(true);
      expect(await exists(db, `users/${fica.uid}/postLikes/${postId}`)).toBe(true);
      expect(await deletedSourcesWithData(db, sai.uid)).toEqual([]);

      // Os dados dos outros, como a exclusão deixou: o convidado desligado, o
      // pedido sem o uid e cancelado, as filas sem o texto e resolvidas, e a
      // Duda fora da lista de bloqueios da Bia.
      expect(await read(db, `referrals/${trazido.uid}`)).toMatchObject({
        inviterUid: null,
        inviterRemovedAt: expect.any(Timestamp),
      });
      expect(await read(db, `redemptions/${redemptionId}`)).toMatchObject({
        uid: null,
        fanName: null,
        accountDeleted: true,
        status: 'canceled',
      });
      expect(await read(db, `moderationQueue/${saiComment}`)).toMatchObject({
        commentText: null,
        status: 'resolved',
      });
      expect(await read(db, `profileReportQueue/${sai.uid}`)).toMatchObject({
        resolvedDigest: null,
        status: 'resolved',
        resolution: 'author_deleted',
      });
      expect(await read(db, `blockLists/${outro.uid}`)).toMatchObject({ blocked: [] });
      expect(JSON.stringify(await read(db, `blockLists/${outro.uid}`))).not.toContain(sai.uid);

      // As contagens do (default) ficam como a exclusão deixou, também com os
      // shards no --path: o shard que a reexclusão criou na cópia (o -1 da
      // Duda, num shard sorteado) fica de fora, e nada desconta duas vezes.
      const counters = await restoreFromCopy(deps, {
        paths: [`artistStats/${artistId}`, `postStats/${postId}`],
        overwrite: false,
        dryRun: false,
      });
      expect(countOf(counters, 'create')).toBe(0);
      expect(counters.written).toEqual({ created: 0, replaced: 0 });
      expect(await shardSum(`artistStats/${artistId}/fanShards`, 'count')).toBe(fans);
      expect(await shardSum(`postStats/${postId}/countShards`, 'likes')).toBe(posts);

      // De novo: nada a criar, e a Duda segue fora.
      const again = await restoreFromCopy(deps, { paths, overwrite: false, dryRun: true });
      expect(countOf(again, 'create')).toBe(0);
      expect(again.reexcluded).toEqual([sai.uid]);
    },
    LONG_MS,
  );

  it.each(['idempotency', 'blockLists'] as const)(
    'a cópia de uma exclusão pela metade: o uid que só sobrou em %s também sai da cópia',
    async (leftover) => {
      const fica = await signUpFan(db, 'Camila Fica');
      const sai = await signUpFan(db, 'Duda Sai');
      // O perfil da Duda já saiu, e sobrou a chave de idempotência dela, ou o
      // uid dela na lista de bloqueios da Camila.
      if (leftover === 'idempotency') {
        await db.doc(`idempotency/${unique('chave-')}`).set({ uid: sai.uid, response: { a: 1 } });
        await db.doc(`idempotency/${unique('chave-')}`).set({ uid: fica.uid, response: { a: 2 } });
      } else {
        await db.doc(`blockLists/${fica.uid}`).set({ blocked: [sai.uid] });
      }
      await cloneDefault();
      await copy.recursiveDelete(copy.doc(`users/${sai.uid}`));
      await copy.recursiveDelete(copy.collection('usernames'));
      expect(await deletedSourcesWithData(copy, sai.uid)).toEqual(
        leftover === 'idempotency' ? ['idempotency'] : [],
      );
      await auth.deleteUser(sai.uid);
      await waitFor(
        'o gatilho da exclusão terminar',
        async () =>
          (await db.collection('idempotency').where('uid', '==', sai.uid).get()).empty &&
          !JSON.stringify((await read(db, `blockLists/${fica.uid}`)) ?? {}).includes(sai.uid),
      );
      await db.recursiveDelete(db.collection(leftover));

      const report = await restoreFromCopy(
        { copy, target: db, auth },
        { paths: [leftover], overwrite: false, dryRun: false },
      );
      expect(report.reexcluded).toEqual([sai.uid]);
      expect(report.written).toEqual({ created: 1, replaced: 0 });
      if (leftover === 'idempotency') {
        const left = await db.collection('idempotency').get();
        expect(left.docs.map((doc) => doc.get('uid'))).toEqual([fica.uid]);
      } else {
        expect(await read(db, `blockLists/${fica.uid}`)).toEqual({ blocked: [] });
      }
    },
  );

  it('o que nasceu na cópia depois da primeira rodada fica de fora, também nas seguintes', async () => {
    await db.doc('rewards/r1').set({ cost: 50 });
    await cloneDefault();
    await db.recursiveDelete(db.collection('rewards'));
    const start = await reexclusionStart(copy);
    // Como um shard que a reexclusão cria na cópia.
    await copy.doc('rewards/r9').set({ cost: -1 });
    const deps = { copy, target: db, auth };
    const paths = ['rewards'];

    const first = await restoreFromCopy(deps, { paths, overwrite: false, dryRun: true });
    expect(kinds(first)).toEqual({ 'rewards/r1': 'create', 'rewards/r9': 'reexclusion' });
    const second = await restoreFromCopy(deps, { paths, overwrite: true, dryRun: false });
    expect(kinds(second)).toEqual({ 'rewards/r1': 'create', 'rewards/r9': 'reexclusion' });
    expect(second.written).toEqual({ created: 1, replaced: 0 });
    expect(await exists(db, 'rewards/r9')).toBe(false);
    expect((await reexclusionStart(copy)).isEqual(start)).toBe(true);
    expect(await exists(copy, RESTORE_MARK)).toBe(true);
    expect(await exists(db, RESTORE_MARK)).toBe(false);
  });
});

describe('o que existe no (default)', () => {
  it('o diferente só é substituído com --overwrite; o perfil com outra foto, nunca; nada é apagado; a referência aponta para o (default)', async () => {
    const fan = await signUpFan(db, 'Bia Foto');
    const at = Timestamp.fromMillis(Date.parse('2026-10-14T15:00:00Z'));
    await db.doc('rewards/r1').set({ title: 'Ingresso', cost: 50, at });
    await db.doc('rewards/r2').set({ title: 'Camisa', cost: 80, at });
    await db.doc('rewards/r4').set({ title: 'Telão', artist: db.doc('artists/nenho') });
    await db.doc(`users/${fan.uid}`).update({ photoPath: `fans/${fan.uid}/photo-aaaaaaaa.jpg` });
    await cloneDefault();

    // Depois da cópia: r1 mudou, r2 sumiu, r3 nasceu; a foto da Bia trocou.
    await db.doc('rewards/r1').update({ cost: 60 });
    await db.doc('rewards/r2').delete();
    await db.doc('rewards/r3').set({ title: 'Videochamada', cost: 90 });
    await db.doc(`users/${fan.uid}`).update({ photoPath: `fans/${fan.uid}/photo-bbbbbbbb.jpg` });
    const deps = { copy, target: db, auth };
    const paths = ['rewards', `users/${fan.uid}`];

    const plain = await restoreFromCopy(deps, { paths, overwrite: false, dryRun: false });
    expect(kinds(plain)).toMatchObject({
      'rewards/r1': 'differs',
      'rewards/r2': 'create',
      'rewards/r4': 'same',
      [`users/${fan.uid}`]: 'differs',
    });
    expect(plain.written).toEqual({ created: 1, replaced: 0 });
    expect(await read(db, 'rewards/r1')).toMatchObject({ cost: 60 });
    expect(await read(db, 'rewards/r2')).toEqual({ title: 'Camisa', cost: 80, at });
    expect(await exists(db, 'rewards/r3')).toBe(true);

    const forced = await restoreFromCopy(deps, { paths, overwrite: true, dryRun: false });
    expect(kinds(forced)).toMatchObject({
      'rewards/r1': 'replace',
      'rewards/r2': 'same',
      'rewards/r4': 'same',
      [`users/${fan.uid}`]: 'profile',
    });
    expect(forced.written).toEqual({ created: 0, replaced: 1 });
    expect(await read(db, 'rewards/r1')).toEqual({ title: 'Ingresso', cost: 50, at });
    expect(await exists(db, 'rewards/r3')).toBe(true);
    expect((await read(db, `users/${fan.uid}`))?.photoPath).toBe(
      `fans/${fan.uid}/photo-bbbbbbbb.jpg`,
    );

    // A referência lida da cópia volta apontando para o (default).
    await db.doc('rewards/r4').delete();
    await restoreFromCopy(deps, { paths: ['rewards/r4'], overwrite: false, dryRun: false });
    const artist = (await read(db, 'rewards/r4'))?.artist as DocumentReference;
    expect(artist).toBeInstanceOf(DocumentReference);
    expect(artist.path).toBe('artists/nenho');
    expect(artist.firestore.databaseId).toBe('(default)');
  });

  it('o que mudou no (default) entre a comparação e a gravação fica como está', async () => {
    await db.doc('rewards/r1').set({ cost: 50 });
    await db.doc('rewards/r2').set({ cost: 80 });
    await db.doc('rewards/r3').set({ cost: 90 });
    await cloneDefault();
    await db.doc('rewards/r1').update({ cost: 55 });
    await db.doc('rewards/r2').delete();
    await db.doc('rewards/r3').delete();

    const plan = await planRestore(copy, db, ['rewards'], true);
    expect(plan.writes.map((write) => [write.path, write.kind])).toEqual([
      ['rewards/r1', 'replace'],
      ['rewards/r2', 'create'],
      ['rewards/r3', 'create'],
    ]);
    // No meio: alguém mexe no r1 e cria o r2.
    await db.doc('rewards/r1').update({ cost: 56 });
    await db.doc('rewards/r2').set({ cost: 81 });

    expect(await applyRestore(db, plan.writes)).toEqual({
      created: 1,
      replaced: 0,
      changed: ['rewards/r1', 'rewards/r2'],
      error: null,
    });
    expect(await read(db, 'rewards/r1')).toEqual({ cost: 56 });
    expect(await read(db, 'rewards/r2')).toEqual({ cost: 81 });
    expect(await read(db, 'rewards/r3')).toEqual({ cost: 90 });
  });

  it('a reexclusão e a gravação recusam o banco que não é de recuperação', async () => {
    const deps = { copy: db, target: db, auth };
    await expect(
      restoreFromCopy(deps, { paths: ['rewards'], overwrite: false, dryRun: true }),
    ).rejects.toThrow('recuperacao-');
    await expect(
      restoreFromCopy(
        { copy, target: copy, auth },
        { paths: ['rewards'], overwrite: false, dryRun: true },
      ),
    ).rejects.toThrow('(default)');
  });
});

const run = promisify(execFile);

/** O script de verdade, com o ambiente do emulador menos `drop`; devolve o código e a saída. */
async function script(
  args: readonly string[],
  drop: readonly string[] = [],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const scriptEnv: NodeJS.ProcessEnv = { ...process.env };
  for (const name of drop) delete scriptEnv[name];
  try {
    const { stdout, stderr } = await run(process.execPath, [SCRIPT, ...args], {
      env: scriptEnv,
      timeout: 60_000,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

describe('o script', () => {
  it('recusa a linha fora do formato, o (default) como cópia, o staff pela coleção e só um dos emuladores', async () => {
    const noFrom = await script(['--path', 'rewards']);
    expect(noFrom.code).toBe(1);
    expect(noFrom.stderr).toContain('Falta o --from.');
    expect(noFrom.stderr).toContain('Uso: node scripts/restore-from-copy.mjs');

    const fromDefault = await script(['--from', '(default)', '--path', 'rewards']);
    expect(fromDefault.code).toBe(1);
    expect(fromDefault.stderr).toContain('nunca o (default)');

    const staff = await script(['--from', COPY, '--path', 'staff', '--dry-run']);
    expect(staff.code).toBe(1);
    expect(staff.stderr).toContain('staff não volta pela coleção');

    const onlyFirestore = await script(
      ['--from', COPY, '--path', 'rewards', '--dry-run'],
      ['FIREBASE_AUTH_EMULATOR_HOST'],
    );
    expect(onlyFirestore.code).toBe(1);
    expect(onlyFirestore.stderr).toContain('Só um dos emuladores');

    const noEmulator = await script(
      ['--from', COPY, '--path', 'rewards', '--dry-run'],
      ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST'],
    );
    expect(noEmulator.code).toBe(1);
    expect(noEmulator.stderr).toContain('Sem FIRESTORE_EMULATOR_HOST e sem --project');
  });

  it('o --dry-run conta e lista sem gravar; a rodada de verdade grava o que ele listou', async () => {
    const fica = await signUpFan(db, 'Camila Fica');
    const sai = await signUpFan(db, 'Duda Sai');
    await db.doc('rewards/r1').set({ title: 'Ingresso', cost: 50 });
    await cloneDefault();
    await auth.deleteUser(sai.uid);
    await waitFor(
      'o gatilho da exclusão terminar',
      async () =>
        !(await exists(db, `wallets/${sai.uid}`)) && !(await exists(db, `users/${sai.uid}`)),
    );
    await db.recursiveDelete(db.collection('users'));
    await db.recursiveDelete(db.collection('rewards'));
    const args = ['--from', COPY, '--path', 'rewards', '--path', 'users'];

    const dry = await script([...args, '--dry-run']);
    expect(dry.code).toBe(0);
    expect(dry.stdout).toContain(`Destino: emuladores ${process.env.FIRESTORE_EMULATOR_HOST}`);
    expect(dry.stdout).toContain(`Cópia: banco ${COPY}. Destino: (default).`);
    expect(dry.stdout).toContain(`Sem conta no Auth hoje: 1, tiradas da cópia`);
    expect(dry.stdout).toContain(sai.uid);
    expect(dry.stdout).toContain('  criar rewards/r1');
    expect(dry.stdout).toContain(`  criar users/${fica.uid}`);
    expect(dry.stdout).not.toContain(`criar users/${sai.uid}`);
    expect(dry.stdout).toContain('--dry-run: nada gravado no (default).');
    expect(await exists(db, 'rewards/r1')).toBe(false);
    expect(await exists(db, `users/${fica.uid}`)).toBe(false);

    const real = await script(args);
    expect(real.code).toBe(0);
    expect(real.stdout).toMatch(/Gravados no \(default\): \d+ criados, 0 substituídos\./);
    expect(await read(db, 'rewards/r1')).toEqual({ title: 'Ingresso', cost: 50 });
    expect(await exists(db, `users/${fica.uid}`)).toBe(true);
    expect(await exists(db, `users/${sai.uid}`)).toBe(false);
  });
});
