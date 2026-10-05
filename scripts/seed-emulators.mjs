/**
 * Contas de teste nos emuladores do Firebase. Rode com `npm run emulators:seed`
 * enquanto `npm run emulators` estiver aberto. Cada conta dispara a função de
 * cadastro, que cria o perfil com o @ em alguns segundos. Depois o script grava
 * a cidade de cada um, como o fã faria no app, para o perfil bater com o protótipo.
 *
 * A Camila ganha a carteira do protótipo (saldo 12.480, XP 12.480, temporada
 * 4.120, Netto 4.120 e Nenho 2.980, "+840" na semana), gravada pelo mesmo
 * lançamento de pontos das funções (functions/lib/points, do build que o
 * `npm run emulators` já faz), com o extrato. O Alan fica sem carteira: é o fã
 * novo.
 *
 * Antes das contas, as centrais de teste (functions/lib/centrals): Netto Brito,
 * Nenho, Juninho Moraes, Rock Salles, Artista 5 e Artista 6 publicadas, o
 * Artista 7 em rascunho e o Artista 8 fora do ar, que o app não mostra. Depois
 * da carteira, a Camila vira fã de Netto, Nenho e Juninho pelo mesmo caminho
 * das rotas da API; o Alan não segue nada e passa pela escolha de artistas.
 * Rodar de novo não muda nada.
 *
 * Só funciona contra o emulador local (127.0.0.1:9099): estas senhas não servem
 * para o projeto de verdade. Os dados somem quando os emuladores fecham, então
 * rode de novo a cada sessão.
 */
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const AUTH_EMULATOR = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const USERS =
  'http://127.0.0.1:8080/v1/projects/demo-imagine-up-app/databases/(default)/documents/users';
// "owner" é o token do emulador que passa por cima das regras.
const OWNER = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };

const FANS = [
  {
    email: 'camila@teste.imagineup',
    password: 'fa-de-teste-1',
    displayName: 'Camila Ribeiro',
    city: 'Feira de Santana, BA',
    wallet: true,
  },
  {
    email: 'alan@teste.imagineup',
    password: 'fa-de-teste-2',
    displayName: 'Alan Ferreira',
    city: 'Irará, BA',
  },
];

async function auth(action, body) {
  const response = await fetch(`${AUTH_EMULATOR}/${action}?key=emulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

/** Espera a função criar users/{uid} (até 60 s, a primeira chamada é lenta) e grava a cidade. */
async function setCity(uid, city) {
  const url = `${USERS}/${uid}?updateMask.fieldPaths=city&currentDocument.exists=true`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: OWNER,
      body: JSON.stringify({ fields: { city: { stringValue: city } } }),
    });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`O perfil ${uid} não apareceu: a função de cadastro está no ar?`);
}

// Só o emulador: o firebase-admin daqui nunca grava fora dele.
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
const PROJECT_ID = 'demo-imagine-up-app';

/** Um módulo do build das funções (functions/lib), com o firebase-admin de lá. */
function functionsBuild(module) {
  const path = fileURLToPath(new URL(`../functions/lib/${module}/index.js`, import.meta.url));
  if (!existsSync(path)) {
    throw new Error('Falta o build das funções: rode npm --prefix functions run build.');
  }
  // firebase-admin e o código das funções saem do mesmo functions/node_modules.
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  return require(path);
}

/** Roda `work` com o Firestore do emulador e fecha as conexões no fim (senão o Node espera). */
async function withFirestore(work) {
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { deleteApp, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = initializeApp({ projectId: PROJECT_ID }, `seed-${Date.now()}`);
  try {
    return await work(getFirestore(app));
  } finally {
    await deleteApp(app);
  }
}

/** As centrais de teste, como o painel publicaria (só as que ainda não existem). */
async function seedCentrals() {
  const { seedCentrals: seed } = functionsBuild('centrals');
  return withFirestore((db) => seed(db));
}

/** A carteira da Camila pelo award das funções e as centrais dela pelo caminho das rotas. */
async function seedWallet(uid) {
  const { seedCamilaWallet } = functionsBuild('points');
  const { seedCamilaCentrals } = functionsBuild('centrals');
  await withFirestore(async (db) => {
    await seedCamilaWallet(db, uid);
    await seedCamilaCentrals(db, uid);
  });
}

const created = await seedCentrals();
console.log(
  `Centrais de teste: ${created} criadas (6 publicadas, 1 em rascunho e 1 fora do ar no total).`,
);

for (const { city, wallet, ...fan } of FANS) {
  let result = await auth('accounts:signUp', fan);
  if (result.ok) {
    console.log(`Conta criada: ${fan.email} (${fan.displayName}).`);
  } else if (result.body.error?.message === 'EMAIL_EXISTS') {
    console.log(`Já existe: ${fan.email}.`);
    result = await auth('accounts:signInWithPassword', fan);
  }
  if (!result.ok) {
    throw new Error(`Não criou ${fan.email}: ${result.body.error?.message ?? result.status}`);
  }
  await setCity(result.body.localId, city);
  console.log(`Cidade de ${fan.displayName}: ${city}.`);
  if (wallet) {
    await seedWallet(result.body.localId);
    console.log(`Carteira de ${fan.displayName}: saldo 12.480, temporada 4.120, Netto e Nenho.`);
    console.log(`Centrais de ${fan.displayName}: Netto Brito, Nenho e Juninho Moraes.`);
  }
}
