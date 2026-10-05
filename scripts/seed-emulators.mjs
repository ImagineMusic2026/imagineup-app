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
 * novo. Rodar de novo não muda nada.
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

/** A carteira da Camila pelo award das funções (o build em functions/lib). */
async function seedWallet(uid) {
  const pointsPath = fileURLToPath(new URL('../functions/lib/points/index.js', import.meta.url));
  if (!existsSync(pointsPath)) {
    throw new Error('Falta o build das funções: rode npm --prefix functions run build.');
  }
  // firebase-admin e o código das funções saem do mesmo functions/node_modules.
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { deleteApp, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { seedCamilaWallet } = require(pointsPath);
  const app = initializeApp({ projectId: PROJECT_ID }, 'seed');
  try {
    await seedCamilaWallet(getFirestore(app), uid);
  } finally {
    // Fecha as conexões do Firestore, senão o Node fica esperando.
    await deleteApp(app);
  }
}

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
  }
}
