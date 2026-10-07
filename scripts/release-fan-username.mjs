/**
 * Libera o @ de um fã para uma central (bloco 9, docs/arquitetura-api.md, 24.9),
 * até as callables do painel do bloco 11. Com o @ escolhido pelo fã, ele pode
 * ficar com o @ de um artista que ainda não tem central, e o createArtist e o
 * checkArtistHandle respondem `taken` para esse @.
 *
 *   npm --prefix functions run build
 *   node scripts/release-fan-username.mjs nettobrito                              (emulador)
 *   node scripts/release-fan-username.mjs nettobrito --project imagine-up-app     (produção)
 *
 * Troca o fã para um @ automático novo (o primeiro livre entre os candidatos do
 * gerador), sem prazo (ele escolhe outro @ na hora), e apaga a reserva, numa
 * transação só, pelo mesmo núcleo da rota (releaseUsername, functions/lib, do
 * build). Recusa sem gravar a reserva que não existe, a de uma central e a que
 * não é o @ de agora do perfil. Imprime o uid e o @ novo, para a equipe avisar
 * o fã; depois, a equipe cria a central. Não grava em staffAudit (não é ação do
 * painel): o registro fica com quem rodou. Em produção, só com o ok do dono.
 *
 * Onde grava (o destino aparece antes de gravar):
 * - com FIRESTORE_EMULATOR_HOST, no emulador (projeto do --project, do
 *   GCLOUD_PROJECT ou demo-imagine-up-app);
 * - sem ele, só com --project escrito: no projeto de verdade, com as
 *   Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS apontando
 *   para uma chave fora do repositório, ou `gcloud auth application-default
 *   login`). Sem nenhum dos dois, recusa: um terminal novo sem a variável do
 *   emulador não grava em produção por engano.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USAGE = [
  'Uso: node scripts/release-fan-username.mjs <@> [--project <id>]',
  '  com FIRESTORE_EMULATOR_HOST: grava no emulador;',
  '  sem ele: só com --project (ex.: --project imagine-up-app), no projeto de verdade.',
].join('\n');

/** O @ e o --project da linha de comando; null se ela não está no formato. */
function parseArgs(args) {
  let username;
  let project;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project') {
      project = args[index + 1];
      index += 1;
      if (!project || project.startsWith('-')) return null;
    } else if (arg.startsWith('--project=')) {
      project = arg.slice('--project='.length);
      if (!project) return null;
    } else if (arg.startsWith('-') || username) {
      return null;
    } else {
      username = arg;
    }
  }
  return username ? { username, project } : null;
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(1);
}
const { username, project } = parsed;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !project) {
  console.error(
    'Sem FIRESTORE_EMULATOR_HOST e sem --project: a troca iria para um projeto de verdade.',
  );
  console.error(USAGE);
  process.exit(1);
}

const functionsPackage = new URL('../functions/package.json', import.meta.url);
const require = createRequire(functionsPackage);
const modulePath = fileURLToPath(new URL('../functions/lib/fan-profile/index.js', import.meta.url));
if (!existsSync(modulePath)) {
  console.error('Falta o build das funções: rode npm --prefix functions run build.');
  process.exit(1);
}

// firebase-admin e o código das funções saem do mesmo functions/node_modules.
const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { releaseUsername, UsernameReleaseError } = require(modulePath);

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
  const result = await releaseUsername(getFirestore(app), username);
  console.log(`@${result.previous} liberado (${where}).`);
  console.log(`O fã ${result.uid} ficou com o @ automático @${result.username}, sem prazo.`);
  console.log('Avise o fã e crie a central com o @ liberado.');
} catch (error) {
  console.error(
    error instanceof UsernameReleaseError ? `Não liberou o @: ${error.message}` : error,
  );
  process.exitCode = 1;
} finally {
  // Fecha as conexões do Firestore, senão o Node fica esperando.
  await deleteApp(app);
}
