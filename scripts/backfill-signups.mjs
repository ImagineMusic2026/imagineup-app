/**
 * Carga única dos cadastros de antes do bloco 5 nos agregados do painel
 * (statsDaily/{dia}/statsShards/backfill, com signups.total), para a
 * retenção por coorte e a parte dos cadastros que veio de convite
 * (docs/arquitetura-api.md, 20.7).
 *
 *   npm --prefix functions run build
 *   node scripts/backfill-signups.mjs                              (emulador)
 *   node scripts/backfill-signups.mjs --project imagine-up-app     (produção)
 *   node scripts/backfill-signups.mjs --dry-run ...                (só mostra)
 *
 * Soma só os perfis sem a marca signupCounted (os que nasceram antes do
 * createUserProfile do bloco 5, ou por uma instância antiga durante a troca de
 * versão do deploy), pelo dia de São Paulo do createdAt, com increment, e
 * marca cada um na mesma transação: rodar de novo só soma os perfis sem a
 * marca que apareceram desde a rodada anterior e nunca desconta (a conta
 * excluída entre duas rodadas continua somada). Mostra os dias e os totais
 * antes de gravar. Rode quando a troca de versão do createUserProfile
 * terminar, de novo uns minutos depois, e antes de o fechamento do dia entrar
 * no ar. Fora do package.json de propósito (os scripts entram no fingerprint
 * da EAS).
 *
 * Onde grava (o destino aparece antes de gravar):
 * - com FIRESTORE_EMULATOR_HOST, no emulador (projeto do --project, do
 *   GCLOUD_PROJECT ou demo-imagine-up-app);
 * - sem ele, só com --project escrito: no projeto de verdade, com as
 *   Application Default Credentials. Sem nenhum dos dois, recusa.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USAGE = [
  'Uso: node scripts/backfill-signups.mjs [--dry-run] [--project <id>]',
  '  com FIRESTORE_EMULATOR_HOST: grava no emulador;',
  '  sem ele: só com --project (ex.: --project imagine-up-app), no projeto de verdade.',
].join('\n');

/** --project e --dry-run da linha de comando; null se ela não está no formato. */
function parseArgs(args) {
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

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(1);
}
const { project, dryRun } = parsed;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !project) {
  console.error(
    'Sem FIRESTORE_EMULATOR_HOST e sem --project: a carga iria para um projeto de verdade.',
  );
  console.error(USAGE);
  process.exit(1);
}

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const backfillPath = fileURLToPath(new URL('../functions/lib/points/backfill.js', import.meta.url));
if (!existsSync(backfillPath)) {
  console.error('Falta o build das funções: rode npm --prefix functions run build.');
  process.exit(1);
}

// firebase-admin e o código das funções saem do mesmo functions/node_modules.
const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { countUnmarkedSignups, writeSignupBackfill } = require(backfillPath);

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
  const db = getFirestore(app);
  const { days, counted, undated } = await countUnmarkedSignups(db);
  const entries = Object.entries(days);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  for (const [day, count] of entries) console.log(`${day}: ${count}`);
  console.log(
    `Cadastros sem a marca: ${total} em ${entries.length} dias. Já contados pelo gatilho: ${counted}.` +
      (undated > 0 ? ` Sem data (de fora): ${undated}.` : ''),
  );
  if (dryRun) {
    console.log('--dry-run: nada gravado.');
  } else {
    // Relê e marca numa transação por grupo de perfis: o que foi somado de
    // fato pode diferir da contagem acima se um perfil sumiu ou nasceu no meio.
    const added = Object.entries(await writeSignupBackfill(db));
    const sum = added.reduce((total, [, count]) => total + count, 0);
    console.log(
      `Carga somada: ${sum} cadastros em ${added.length} dias (statsDaily/{dia}/statsShards/backfill), perfis marcados.`,
    );
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  // Fecha as conexões do Firestore, senão o Node fica esperando.
  await deleteApp(app);
}
