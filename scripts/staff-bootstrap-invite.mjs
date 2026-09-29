/**
 * Convite do PRIMEIRO admin do painel. Depois dele, os convites saem do
 * próprio painel (createStaffInvite).
 *
 *   npm --prefix functions run build
 *   node scripts/staff-bootstrap-invite.mjs pessoa@exemplo.com                       (emulador)
 *   node scripts/staff-bootstrap-invite.mjs pessoa@exemplo.com --project imagine-up-app  (produção)
 *
 * Grava staffInvites/{id} com papel admin e todas as seções, invitedBy null e
 * invitedByName "Equipe ImagineUP", mais a entrada invite.created na
 * auditoria (actorUid null). Não manda e-mail: mostra o link, que vale 7 dias
 * e uma vez só. Recusa se já existe admin ativo, se o e-mail já é da equipe
 * ou se já há um convite pendente e ainda válido para ele (um vencido é
 * trocado por este).
 *
 * Onde grava (o destino aparece antes de gravar):
 * - com FIRESTORE_EMULATOR_HOST, no emulador (projeto do --project, do
 *   GCLOUD_PROJECT ou demo-imagine-up-app);
 * - sem ele, só com --project escrito: no projeto de verdade, com as
 *   Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS apontando
 *   para uma chave fora do repositório, ou `gcloud auth application-default
 *   login`). Sem nenhum dos dois, recusa: um terminal novo sem a variável do
 *   emulador não grava em produção por engano.
 *
 * O link usa PANEL_URL (padrão http://localhost:3000). A lógica é a mesma das
 * Cloud Functions (functions/lib, do build): token de 32 bytes, só o sha256
 * no banco.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const USAGE = [
  'Uso: node scripts/staff-bootstrap-invite.mjs pessoa@exemplo.com [--project <id>]',
  '  com FIRESTORE_EMULATOR_HOST: grava no emulador;',
  '  sem ele: só com --project (ex.: --project imagine-up-app), no projeto de verdade.',
].join('\n');

/** E-mail e --project da linha de comando; null se ela não está no formato. */
function parseArgs(args) {
  let email;
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
    } else if (arg.startsWith('-') || email) {
      return null;
    } else {
      email = arg;
    }
  }
  return email ? { email, project } : null;
}

const parsed = parseArgs(process.argv.slice(2));
if (!parsed) {
  console.error(USAGE);
  process.exit(1);
}
const { email, project } = parsed;
const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator && !project) {
  console.error(
    'Sem FIRESTORE_EMULATOR_HOST e sem --project: o convite iria para um projeto de verdade.',
  );
  console.error(USAGE);
  process.exit(1);
}

const functionsPackage = new URL('../functions/package.json', import.meta.url);
const require = createRequire(functionsPackage);
const servicePath = fileURLToPath(new URL('../functions/lib/staff/service.js', import.meta.url));
if (!existsSync(servicePath)) {
  console.error('Falta o build das funções: rode npm --prefix functions run build.');
  process.exit(1);
}

// firebase-admin e o código das funções saem do mesmo functions/node_modules.
const { applicationDefault, deleteApp, initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createBootstrapInvite } = require(servicePath);
const { expiresLabel } = require(
  fileURLToPath(new URL('../functions/lib/staff/email.js', import.meta.url)),
);

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
const panelUrl = process.env.PANEL_URL || 'http://localhost:3000';

try {
  const invite = await createBootstrapInvite({ db: getFirestore(app), panelUrl }, email);
  console.log(`Convite do primeiro admin criado para ${invite.email} (${where}).`);
  console.log(
    `Vale até ${expiresLabel(new Date(invite.expiresAt))} (horário de Brasília), uma vez só.`,
  );
  console.log('Abra o link, escolha nome e senha e entre no painel:');
  console.log(invite.inviteUrl);
} catch (error) {
  const reason = error?.details?.reason;
  console.error(reason ? `Não criou o convite: ${error.message}` : error);
  process.exitCode = 1;
} finally {
  // Fecha as conexões do Firestore, senão o Node fica esperando.
  await deleteApp(app);
}
