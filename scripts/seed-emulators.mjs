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
 *
 * Convite (functions/lib/invites, bloco 5): a Camila ganha o código CAMILA12
 * (o mesmo da fixture) e 4 links compartilhados (o atalho Convidar, o clipe, a
 * central do Netto e a agenda), e traz três fãs de teste pelo mesmo claim da
 * API, com os valores do convite em 0 (a carteira dela fica a do protótipo):
 * a Bia pelo link do clipe com campanha (instagram, story, sao-joao), a Duda
 * pelo link da central do Netto e o Enzo pelo código digitado no cadastro. A
 * 1e da Camila mostra 4 links e 3 pessoas trazidas; o Alan ganha o código na
 * primeira vez que abrir "Gerar meu link".
 *
 * Mural e agenda (functions/lib/agenda e functions/lib/posts, bloco 6): antes
 * das contas, os shows da agenda de exemplo do app (os mesmos ids e datas, na
 * hora local do lugar, com o São João de Irará em destaque e um rascunho) e os
 * 10 posts de exemplo (o clipe do Netto, o post de show do Nenho, que aponta
 * para o Arrocha na Praia, e os outros, mais um rascunho); os posts vêm antes
 * das contas porque o link post:p-clipe da Camila exige o post no ar. Por
 * último, o engajamento dos fãs de teste pelos mesmos núcleos das rotas, com
 * curtir, comentar e "Eu vou" valendo 0 (nenhuma carteira muda): curtidas no
 * clipe, no show e em outros posts, 7 comentários (4 no clipe, 2 no show, 1 no
 * texto), presenças da Bia e da Duda e a denúncia do Alan ao comentário do Enzo
 * no show, que abre a fila da Moderação. A Camila não curte, não comenta e não
 * vai a show nenhum: a primeira ação dela no app mostra os pontos do servidor.
 *
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
  // Convidados da Camila: a origem de cada um está em SEED_INVITEES
  // (functions/src/invites/seed.ts), pelo e-mail.
  {
    email: 'bia@teste.imagineup',
    password: 'fa-de-teste-3',
    displayName: 'Bia Santos',
    city: 'Salvador, BA',
    invited: true,
  },
  {
    email: 'duda@teste.imagineup',
    password: 'fa-de-teste-4',
    displayName: 'Duda Lima',
    city: 'Alagoinhas, BA',
    invited: true,
  },
  {
    email: 'enzo@teste.imagineup',
    password: 'fa-de-teste-5',
    displayName: 'Enzo Rocha',
    city: 'Santo Amaro, BA',
    invited: true,
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

/** Os shows e os posts de teste, como o painel publicaria (só os que ainda não existem). */
async function seedContent() {
  const { seedEvents } = functionsBuild('agenda');
  const { seedPosts } = functionsBuild('posts');
  return withFirestore(async (db) => ({
    events: await seedEvents(db),
    posts: await seedPosts(db),
  }));
}

/** Curtidas, comentários, presenças e a denúncia dos fãs de teste, pelos núcleos das rotas. */
async function seedEngagement(fans) {
  const { seedEngagement: seed } = functionsBuild('posts');
  return withFirestore((db) => seed(db, fans));
}

/**
 * A carteira da Camila pelo award das funções, as centrais dela pelo caminho
 * das rotas e o convite dela (o código CAMILA12 e os links).
 */
async function seedWallet(uid, email) {
  const { seedCamilaWallet } = functionsBuild('points');
  const { seedCamilaCentrals } = functionsBuild('centrals');
  const { seedCamilaInvite } = functionsBuild('invites');
  return withFirestore(async (db) => {
    await seedCamilaWallet(db, uid);
    await seedCamilaCentrals(db, uid);
    return seedCamilaInvite(db, { uid, email });
  });
}

/** Os convidados da Camila pelo mesmo claim da API, cada um com a origem do SEED_INVITEES. */
async function seedClaims(invitees) {
  const { SEED_INVITEES, seedInviteClaims } = functionsBuild('invites');
  const withOrigin = invitees.map((invitee) => {
    const seed = SEED_INVITEES.find((item) => item.email === invitee.email);
    if (!seed) throw new Error(`Sem origem de convite para ${invitee.email}.`);
    return { ...invitee, origin: seed.origin };
  });
  return withFirestore((db) => seedInviteClaims(db, withOrigin));
}

const created = await seedCentrals();
console.log(
  `Centrais de teste: ${created} criadas (6 publicadas, 1 em rascunho e 1 fora do ar no total).`,
);

const content = await seedContent();
console.log(
  `Agenda e mural de teste: ${content.events} shows e ${content.posts} posts criados (9 shows e 10 posts no ar no total).`,
);

const invitees = [];
const engagementFans = {};
for (const { city, wallet, invited, ...fan } of FANS) {
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
    const links = await seedWallet(result.body.localId, fan.email);
    console.log(`Carteira de ${fan.displayName}: saldo 12.480, temporada 4.120, Netto e Nenho.`);
    console.log(`Centrais de ${fan.displayName}: Netto Brito, Nenho e Juninho Moraes.`);
    console.log(
      `Convite de ${fan.displayName}: código CAMILA12, ${links} links novos (4 no total).`,
    );
  }
  if (invited) invitees.push({ uid: result.body.localId, email: fan.email, name: fan.displayName });
  const key = fan.email.split('@')[0];
  if (key !== 'camila') engagementFans[key] = result.body.localId;
}

const outcomes = await seedClaims(invitees);
invitees.forEach((invitee, index) => {
  const status = outcomes[index]?.status === 'claimed' ? 'convidado agora' : 'já era convidado';
  console.log(`Convite da Camila: ${invitee.name} (${status}).`);
});

const engagement = await seedEngagement(engagementFans);
console.log(
  `Engajamento dos fãs de teste, entrando agora: curtidas ${engagement.likes}, comentários ${engagement.comments}, presenças ${engagement.rsvps}, denúncias ${engagement.reports} (7, 7, 2 e 1 no total).`,
);
