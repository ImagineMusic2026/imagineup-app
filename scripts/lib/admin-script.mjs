/**
 * O que as cargas do bloco 11 dividem (docs/arquitetura-api.md, 26.9), no
 * molde da scripts/backfill-signups.mjs: a linha de comando (--dry-run e
 * --project), o destino, o build das funções e o app do Admin SDK.
 *
 * Onde grava (o destino aparece antes de gravar):
 * - com FIRESTORE_EMULATOR_HOST, no emulador (projeto do --project, do
 *   GCLOUD_PROJECT ou demo-imagine-up-app);
 * - sem ele, só com --project escrito: no projeto de verdade, com as
 *   Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS com uma
 *   chave fora do repositório, ou `gcloud auth application-default login`).
 *   Sem nenhum dos dois, recusa: um terminal novo sem a variável do emulador
 *   não grava em produção por engano.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

/** --project e --dry-run da linha de comando; null se ela não está no formato. */
export function parseArgs(args) {
  let project;
  let dryRun = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--project') {
      project = args[index + 1];
      index += 1;
      if (!project || project.startsWith('-')) return null;
    } else if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length);
      if (!project) return null;
    } else {
      return null;
    }
  }
  return { project, dryRun };
}

/**
 * Roda uma carga: confere a linha de comando e o destino, carrega o build
 * (`functions/lib/<build>`), mostra o destino, abre o app do Admin SDK e
 * chama `run({ db, dryRun, lib })`. Erro sai com código 1; as conexões fecham
 * no fim.
 */
export async function runAdminScript({ script, build, run }) {
  const usage = [
    `Uso: node scripts/${script} [--dry-run] [--project <id>]`,
    '  com FIRESTORE_EMULATOR_HOST: grava no emulador;',
    '  sem ele: só com --project (ex.: --project imagine-up-app), no projeto de verdade.',
  ].join('\n');
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) {
    console.error(usage);
    process.exitCode = 1;
    return;
  }
  const { project, dryRun } = parsed;
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  if (!emulator && !project) {
    console.error(
      'Sem FIRESTORE_EMULATOR_HOST e sem --project: a carga iria para um projeto de verdade.',
    );
    console.error(usage);
    process.exitCode = 1;
    return;
  }

  const require = createRequire(new URL('../../functions/package.json', import.meta.url));
  const buildPath = fileURLToPath(new URL(`../../functions/lib/${build}`, import.meta.url));
  if (!existsSync(buildPath)) {
    console.error('Falta o build das funções: rode npm --prefix functions run build.');
    process.exitCode = 1;
    return;
  }

  // firebase-admin e o código das funções saem do mesmo functions/node_modules.
  const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const lib = require(buildPath);

  const projectId = emulator
    ? project || process.env.GCLOUD_PROJECT || 'demo-imagine-up-app'
    : project;
  const where = emulator
    ? `emulador ${emulator}, projeto ${projectId}`
    : `projeto ${projectId} de verdade, com as Application Default Credentials`;
  console.log(`Destino: ${where}.`);

  const app = emulator
    ? initializeApp({ projectId })
    : initializeApp({ projectId, credential: applicationDefault() });
  try {
    await run({ db: getFirestore(app), dryRun, lib });
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    // Fecha as conexões do Firestore, senão o Node fica esperando.
    await deleteApp(app);
  }
}
