/**
 * Roteiro de restauração (docs/arquitetura-api.md, 31.3): copia de volta para
 * o (default) os documentos de um banco de recuperação, o criado pelo
 * `gcloud firestore databases clone` (PITR) ou pelo `restore` (backup diário),
 * sem trazer de volta quem excluiu a conta depois da cópia.
 *
 *   npm --prefix functions run build
 *   node scripts/restore-from-copy.mjs --from recuperacao-20261015 --path rewards --dry-run --project imagine-up-app
 *   node scripts/restore-from-copy.mjs --from recuperacao-20261015 --path rewards --project imagine-up-app
 *
 * A rodada (functions/lib/restore, do build):
 * 1. as contas que a cópia conhece (toda fonte da FAN_DATA_SOURCES lida pelo
 *    uid) sem conta no Auth hoje saem da cópia pelo mesmo deleteUserData do
 *    gatilho deleteUserProfile (seção 12). O app não guarda lista de quem
 *    excluiu a conta: a exclusão começa sempre pelo Auth (pelo app ou pelo
 *    deleteFanAccount do painel), e nenhuma das cópias leva o Auth. Roda
 *    também no --dry-run: a cópia é descartável, e o (default) não muda;
 * 2. cada documento debaixo dos --path é comparado com o do (default): o que
 *    falta volta; o que existe diferente só volta com --overwrite (o perfil
 *    com outra foto ou outro @, nunca); o igual fica; o que a reexclusão
 *    criou na cópia (o shard com o -1 de quem saiu) fica de fora. Nada é
 *    apagado do (default). O staff e o staffInvites só voltam por documento;
 * 3. sem --dry-run, grava de 100 em 100, numa transação que relê cada
 *    documento: o que mudou desde a comparação fica como está e aparece na
 *    lista. No fim, confere o Auth de novo. Sai com 1 se a gravação parou
 *    num erro (o resumo sai igual) e com 2 se uma conta saiu do Auth no meio.
 *
 * Fora do package.json de propósito (os scripts entram no fingerprint da EAS).
 * Em produção, só com o ok do dono, primeiro com --dry-run (31.3).
 *
 * Onde grava (o destino aparece antes de gravar):
 * - com FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST, nos emuladores
 *   (projeto do --project, do GCLOUD_PROJECT ou demo-imagine-up-app); com só
 *   um dos dois, recusa: o Firestore do emulador com o Auth de verdade
 *   tiraria da cópia todas as contas;
 * - sem eles, só com --project escrito: no projeto de verdade, com as
 *   Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS com uma
 *   chave fora do repositório, ou `gcloud auth application-default login`).
 *   Sem nenhum dos dois, recusa: um terminal novo sem a variável do emulador
 *   não grava em produção por engano.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const modulePath = fileURLToPath(new URL('../functions/lib/restore/index.js', import.meta.url));
if (!existsSync(modulePath)) {
  console.error('Falta o build das funções: rode npm --prefix functions run build.');
  process.exit(1);
}

// firebase-admin e o código das funções saem do mesmo functions/node_modules.
const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { formatRestoreReport, parseRestoreArgs, RESTORE_USAGE, restoreFromCopy } = require(
  modulePath,
);

const parsed = parseRestoreArgs(process.argv.slice(2));
if ('error' in parsed) {
  console.error(parsed.error);
  console.error(RESTORE_USAGE);
  process.exit(1);
}
const { from, paths, overwrite, dryRun, project } = parsed;
const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST;
const authEmulator = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (Boolean(firestoreEmulator) !== Boolean(authEmulator)) {
  console.error(
    'Só um dos emuladores na variável: rode com FIRESTORE_EMULATOR_HOST e FIREBASE_AUTH_EMULATOR_HOST, ou sem nenhum dos dois.',
  );
  process.exit(1);
}
if (!firestoreEmulator && !project) {
  console.error(
    'Sem FIRESTORE_EMULATOR_HOST e sem --project: a restauração iria para um projeto de verdade.',
  );
  console.error(RESTORE_USAGE);
  process.exit(1);
}

const projectId = firestoreEmulator
  ? project || process.env.GCLOUD_PROJECT || 'demo-imagine-up-app'
  : project;
const where = firestoreEmulator
  ? `emuladores ${firestoreEmulator} e ${authEmulator}, projeto ${projectId}`
  : `projeto ${projectId} de verdade, com as Application Default Credentials`;
console.log(`Destino: ${where}.`);

const app = firestoreEmulator
  ? initializeApp({ projectId })
  : initializeApp({ projectId, credential: applicationDefault() });

try {
  const report = await restoreFromCopy(
    { copy: getFirestore(app, from), target: getFirestore(app), auth: getAuth(app) },
    { paths, overwrite, dryRun },
  );
  for (const line of formatRestoreReport(report)) console.log(line);
  if (report.error !== null) process.exitCode = 1;
  else if (report.late.length > 0) process.exitCode = 2;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Fecha as conexões do Firestore, senão o Node fica esperando.
  await deleteApp(app);
}
