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
 * Missões, conquistas e meta da temporada (functions/lib/missions, bloco 7,
 * docs/arquitetura-api.md, 22.13): a carteira da Camila leva 12 lançamentos
 * de missão (a meta da temporada, "Semana do arrocha", fica em 12 de 20) e as
 * conquistas do padrão do código (Missão cumprida, Pé de serra, Sanfona e
 * Purainha). A ordem decide o progresso dela, que sai das próprias ações: os
 * claims da Duda (link da central, dá o "Boca a boca") e do Enzo (código)
 * vêm antes do catálogo de missões; depois, o catálogo provisório (as missões
 * das fixtures sem a relâmpago), o claim da Bia (anda "Leve 5 pessoas" e
 * "Traga 3 amigos"), as visitas do Alan e da Gabi Souza (conta nova, só para
 * visitar) ao link do clipe ("Leve 5 pessoas" em 3 de 5) e as curtidas da
 * Camila nos posts p-nenho-4 e p-nenho-5 ("Curta 5 posts do Nenho" em 2 de 5,
 * curtir valendo 0). O engajamento dos fãs de teste vem por último, sem o jogo.
 *
 * Ranking e temporadas (functions/lib/ranking, bloco 8, docs/arquitetura-api.md,
 * 23.15): 48 contas de ranking (rank-01@teste.imagineup a rank-48@teste.imagineup,
 * com nome e cidade), as duas temporadas passadas (Verão e Carnaval) lançadas
 * e fechadas pela própria virada, antes de qualquer ponto do São João (as 3
 * temporadas da 1e), a base de 8 dias atrás (da Camila e das 48, com a entrada
 * nas centrais), o retrato desta semana tirado pela própria função (a seta) e,
 * depois dele, a semana (os +840 da Camila). A Camila fica em 12º no geral com
 * 4.120 e a seta +2, a 840 do top 10, em 12º no Netto e em 41º no Nenho; o
 * pódio é Thalita, Davi e Jean. Numa semana nova, o retrato sai com o estado
 * de agora e as setas ficam em 0: feche os emuladores e rode o seed outra vez.
 *
 * Perfil editável (functions/lib/fan-profile, bloco 9, 24.13): no fim, a
 * Camila ganha a foto de teste (scripts/seed-assets/foto-teste.jpg, o degradê
 * rosa para roxo da marca com as listras, sem rosto e sem texto), enviada ao
 * emulador do Storage e gravada pelo mesmo núcleo da rota PUT /me/photo. Ela
 * aparece na 1b, na 1e, no card "Você" e nas linhas dela no ranking; as
 * temporadas fechadas ficam sem a foto (o arquivo é da hora da virada). Os
 * outros fãs ficam sem foto.
 *
 * Loja e resgate (functions/lib/rewards, bloco 10, 25.13): depois dos shows,
 * o catálogo das fixtures do app (o meet & greet do São João de Irará em
 * destaque, com escassez e 20 vagas; os ingressos com limite de 2; a
 * videochamada; a camisa sem limite; o telão; a passagem de som do Arrocha na
 * Praia com 1 vaga; e um rascunho), todas no ar e sem foto. Depois da carteira,
 * os pedidos antigos da Camila pelos mesmos núcleos da rota e das callables,
 * às 18:00 de cada dia: o ajuste seed:camila-loja (+24.000 só no saldo, 8 dias
 * atrás), os ingressos entregues (UP-4KD9TM), a videochamada recusada com o
 * motivo e os 8.500 de volta (UP-9FJT6V), a passagem de som aprovada, que
 * esgota (UP-7QXH2R), e a camisa solicitada (UP-C3NWPB). O saldo termina em
 * 12.480, e o extrato dela ganha 6 lançamentos (23 ao todo).
 *
 * Equipe do painel (functions/lib/staff/seed.js): equipe@teste.imagineup
 * (admin, todas as seções), editora@teste.imagineup (editor com Fãs, Missões,
 * Recompensas e Moderação, sem Artistas) e leitor@teste.imagineup (leitor de
 * todas as seções), gravadas como o aceite do convite deixaria (staff/{uid}
 * antes da conta, sem perfil de fã), para as callables no emulador e para o
 * painel local.
 *
 * Telas do painel (bloco 11, docs/arquitetura-api.md, 26.13): a versão 1 de
 * config/points e config/achievements (a mesma carga de produção, antes do
 * catálogo de missões, com as auditorias config.seeded); o fã de propaganda
 * (Promo Seguidores, spam@teste.imagineup) com a foto de teste e três
 * comentários no clipe do Netto, denunciados pela Bia e pela Duda, um deles
 * ocultado pela equipe (a fila da Moderação fica com três itens abertos e um
 * resolvido); o rank-48 suspenso pela equipe (a api responde 403 a ele); os
 * ingressos pedidos pelos rank-01 a rank-04 (quatro pedidos solicitados de
 * outros fãs); a meta da São João batida pelo rank-02; umas 20 entradas de
 * auditoria de exemplo nos últimos 10 dias; e, por último, os números de 60
 * dias até ontem (um shard `seed` por dia), fechados pelo mesmo fechamento de
 * produção com o retrato do seed. Hoje fica aberto. No fim, o script mostra
 * os totais fechados de 7 e 30 dias que a Visão geral tem de mostrar.
 *
 * Rodar de novo não muda nada. Depois da meia-noite, o progresso do dia volta
 * a 0, como o de qualquer fã: para ver de novo o 3 de 5 e o 2 de 5, feche os
 * emuladores (os dados somem) e rode o seed outra vez.
 *
 * Só funciona contra o emulador local (127.0.0.1:9099): estas senhas não servem
 * para o projeto de verdade. Os dados somem quando os emuladores fecham, então
 * rode de novo a cada sessão.
 */
import { existsSync, readFileSync } from 'node:fs';
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
  // Só visita o link do clipe da Camila (bloco 7): anda o "Leve 5 pessoas".
  {
    email: 'gabi@teste.imagineup',
    password: 'fa-de-teste-6',
    displayName: 'Gabi Souza',
    city: 'Cruz das Almas, BA',
  },
  // O fã de propaganda da Moderação (bloco 11): foto, três comentários no
  // clipe, denunciados pela Bia e pela Duda. Sem cidade.
  {
    email: 'spam@teste.imagineup',
    password: 'fa-de-teste-7',
    displayName: 'Promo Seguidores',
    city: null,
  },
];

/** As senhas das contas da equipe do painel no emulador (as contas estão em functions/src/staff/seed.ts). */
const STAFF_PASSWORDS = {
  'seed-equipe': 'equipe-de-teste-1',
  'seed-editora': 'editora-de-teste-1',
  'seed-leitor': 'leitor-de-teste-1',
};

/** A senha das 48 contas de ranking (só o emulador). */
const RANKING_PASSWORD = 'fa-do-ranking';

/** Os claims que vêm antes do catálogo de missões (não andam missão nenhuma, 22.13). */
const CLAIMS_BEFORE_CATALOG = ['duda@teste.imagineup', 'enzo@teste.imagineup'];

async function auth(action, body) {
  const response = await fetch(`${AUTH_EMULATOR}/${action}?key=emulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  return { ok: response.ok, status: response.status, body: await response.json() };
}

/** Espera a função criar users/{uid} (até 60 s, a primeira chamada é lenta), sem gravar nada. */
async function waitForProfile(uid) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(`${USERS}/${uid}`, { headers: OWNER });
    if (response.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`O perfil ${uid} não apareceu: a função de cadastro está no ar?`);
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
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099';
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199';
const PROJECT_ID = 'demo-imagine-up-app';
// O bucket do projeto demo, o mesmo das funções, do painel e do app no emulador.
const STORAGE_BUCKET = `${PROJECT_ID}.appspot.com`;

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

/** Um arquivo do build das funções fora do index do módulo (`functions/lib/<path>.js`). */
function functionsFile(path) {
  const full = fileURLToPath(new URL(`../functions/lib/${path}.js`, import.meta.url));
  if (!existsSync(full)) {
    throw new Error('Falta o build das funções: rode npm --prefix functions run build.');
  }
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  return require(full);
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

/** Roda `work` com o Firestore e o bucket do Storage do emulador, e fecha no fim. */
async function withStorage(work) {
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { deleteApp, initializeApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp(
    { projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET },
    `seed-storage-${Date.now()}`,
  );
  try {
    return await work(getFirestore(app), getStorage(app).bucket(STORAGE_BUCKET));
  } finally {
    await deleteApp(app);
  }
}

/** A foto de teste de um fã, pelo mesmo núcleo da rota (só se ele ainda não tem foto). */
async function seedPhoto(uid, fileName) {
  const { fanPhotoFiles, seedFanPhoto } = functionsBuild('fan-profile');
  const bytes = readFileSync(new URL('./seed-assets/foto-teste.jpg', import.meta.url));
  return withStorage((db, bucket) =>
    seedFanPhoto(
      db,
      fanPhotoFiles(() => bucket),
      (path, data) => bucket.file(path).save(Buffer.from(data), { contentType: 'image/jpeg' }),
      uid,
      new Uint8Array(bytes),
      fileName ? { fileName } : {},
    ),
  );
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

/** O catálogo da loja, como o painel cadastraria e publicaria (só as que faltam). */
async function seedShop() {
  const { seedRewards } = functionsBuild('rewards');
  return withFirestore((db) => seedRewards(db));
}

/** Os pedidos antigos da Camila, pelos núcleos da rota e das callables (rodar de novo não muda nada). */
async function seedCamilaShop(uid) {
  const { seedCamilaRedemptions } = functionsBuild('rewards');
  return withFirestore((db) => seedCamilaRedemptions(db, uid));
}

/**
 * As contas da equipe do painel (admin, editora e leitor): staff/{uid} antes
 * da conta (como o aceite do convite), para o gatilho de cadastro não criar
 * perfil de fã. Já existe: nada muda. Devolve o que aconteceu com cada uma.
 */
async function seedStaff() {
  const require = createRequire(new URL('../functions/package.json', import.meta.url));
  const { deleteApp, initializeApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const { SEED_STAFF, seedStaffMember } = functionsFile('staff/seed');
  const app = initializeApp({ projectId: PROJECT_ID }, `seed-staff-${Date.now()}`);
  try {
    const db = getFirestore(app);
    const auth = getAuth(app);
    const outcomes = [];
    for (const member of SEED_STAFF) {
      const status = await seedStaffMember(db, auth, member, STAFF_PASSWORDS[member.uid]);
      outcomes.push({ member, status });
    }
    return outcomes;
  } finally {
    await deleteApp(app);
  }
}

/** O catálogo provisório de missões, com a meta da temporada (só se ainda não existe). */
async function seedMissions() {
  const { seedMissionsCatalog } = functionsBuild('missions');
  return withFirestore((db) => seedMissionsCatalog(db));
}

/** As visitas de teste ao link do clipe da Camila, pelo mesmo núcleo da rota. */
async function seedVisits(visitors) {
  const { seedInviteVisits } = functionsBuild('invites');
  return withFirestore((db) => seedInviteVisits(db, visitors));
}

/** As curtidas da Camila nos dois posts do Nenho, com o jogo (a missão de curtida anda). */
async function seedCamilaLikes(uid) {
  const { seedCamilaLikes: seed } = functionsBuild('posts');
  return withFirestore((db) => seed(db, uid));
}

/** Curtidas, comentários, presenças e a denúncia dos fãs de teste, pelos núcleos das rotas. */
async function seedEngagement(fans) {
  const { seedEngagement: seed } = functionsBuild('posts');
  return withFirestore((db) => seed(db, fans));
}

/**
 * A carteira da Camila até 8 dias atrás (as missões antigas e a base) pelo
 * award das funções, as centrais dela pelo caminho das rotas e o convite dela
 * (o código CAMILA12 e os links). A semana entra depois do retrato.
 */
async function seedWallet(uid, email) {
  const { seedCamilaWallet } = functionsBuild('points');
  const { seedCamilaCentrals } = functionsBuild('centrals');
  const { seedCamilaInvite } = functionsBuild('invites');
  return withFirestore(async (db) => {
    await seedCamilaWallet(db, uid, { steps: 'early' });
    await seedCamilaCentrals(db, uid);
    return seedCamilaInvite(db, { uid, email });
  });
}

/** Cria a conta pelo emulador de Auth (ou entra nela, se já existe) e devolve o uid. */
async function account({ email, password, displayName }) {
  let result = await auth('accounts:signUp', { email, password, displayName });
  if (result.ok) {
    console.log(`Conta criada: ${email} (${displayName}).`);
  } else if (result.body.error?.message === 'EMAIL_EXISTS') {
    console.log(`Já existe: ${email}.`);
    result = await auth('accounts:signInWithPassword', { email, password });
  }
  if (!result.ok) {
    throw new Error(`Não criou ${email}: ${result.body.error?.message ?? result.status}`);
  }
  return result.body.localId;
}

/** As 48 contas de ranking, em levas de 8, cada uma esperando o próprio perfil. */
async function rankingAccounts() {
  const { RANKING_SEED } = functionsBuild('ranking');
  const uids = new Map();
  for (let start = 0; start < RANKING_SEED.length; start += 8) {
    await Promise.all(
      RANKING_SEED.slice(start, start + 8).map(async (item) => {
        const uid = await account({
          email: item.email,
          password: RANKING_PASSWORD,
          displayName: item.name,
        });
        if (item.city) await setCity(uid, item.city);
        else await waitForProfile(uid);
        uids.set(item.email, uid);
      }),
    );
  }
  return uids;
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
  `Agenda e mural de teste: ${content.events} shows e ${content.posts} posts criados (9 shows e 12 posts no ar no total).`,
);

const shopCreated = await seedShop();
console.log(
  `Loja de teste: ${shopCreated} recompensas criadas (6 no ar e 1 em rascunho no total).`,
);

const ROLE_NAMES = { admin: 'admin', editor: 'editora', viewer: 'leitor' };
for (const { member, status } of await seedStaff()) {
  console.log(
    `Equipe do painel: ${member.email} (${ROLE_NAMES[member.role]}, ${status === 'created' ? 'criada agora' : 'já existia'}).`,
  );
}

// A versão 1 de config/points e config/achievements, antes do catálogo de missões (26.13).
const gameConfig = await withFirestore((db) =>
  functionsFile('points/config-seed').seedGameConfig(db),
);
console.log(
  `Configuração inicial: ${gameConfig.length > 0 ? `${gameConfig.join(' e ')} na versão 1 agora` : 'config/points e config/achievements já existiam'}.`,
);

const invitees = [];
const visitors = [];
const engagementFans = {};
/** Os uids dos fãs de teste pelo nome curto do e-mail (camila, alan, bia, duda, enzo, gabi, spam). */
const fanUids = {};
let camilaUid = null;
let camilaEmail = null;
for (const { city, wallet, invited, ...fan } of FANS) {
  const uid = await account(fan);
  if (city) {
    await setCity(uid, city);
    console.log(`Cidade de ${fan.displayName}: ${city}.`);
  } else {
    await waitForProfile(uid);
  }
  if (wallet) {
    camilaUid = uid;
    camilaEmail = fan.email;
  }
  if (invited) invitees.push({ uid, email: fan.email, name: fan.displayName });
  const key = fan.email.split('@')[0];
  fanUids[key] = uid;
  if (key !== 'camila' && key !== 'gabi' && key !== 'spam') engagementFans[key] = uid;
  const { SEED_VISITORS } = functionsBuild('invites');
  if (SEED_VISITORS.includes(fan.email)) {
    visitors.push({ uid, email: fan.email, name: fan.displayName });
  }
}

const rankingUids = await rankingAccounts();
console.log(`Contas de ranking: ${rankingUids.size} (rank-01 a rank-48@teste.imagineup).`);

// As temporadas passadas antes de qualquer ponto do São João (23.15).
const { seedPastSeasons, seedRankingBase, seedRankingSnapshot, seedRankingWeek } =
  functionsBuild('ranking');
const pastSeasons = await withFirestore((db) => seedPastSeasons(db, rankingUids, camilaUid));
console.log(
  `Temporadas passadas: ${pastSeasons ? 'Verão e Carnaval lançados e fechados pela virada' : 'já existiam'} (a Camila em 25º e 36º).`,
);

if (camilaUid) {
  const links = await seedWallet(camilaUid, camilaEmail);
  console.log('Carteira da Camila até 8 dias atrás: as missões antigas e a base.');
  console.log('Centrais da Camila: Netto Brito, Nenho e Juninho Moraes.');
  console.log(`Convite da Camila: código CAMILA12, ${links} links novos (4 no total).`);
}

await withFirestore((db) => seedRankingBase(db, rankingUids));
console.log('Ranking: a base de 8 dias atrás das 48 contas, membros das centrais em que pontuam.');
await withFirestore((db) => seedRankingSnapshot(db));
console.log('Ranking: o retrato desta semana (a seta) e o Top 20 de quem estava até o 20º.');

if (camilaUid) {
  const { seedCamilaWallet } = functionsBuild('points');
  await withFirestore((db) => seedCamilaWallet(db, camilaUid, { steps: 'week' }));
  console.log('Carteira da Camila: saldo 12.480, temporada 4.120, Netto e Nenho, +840 na semana.');
}
await withFirestore((db) => seedRankingWeek(db, rankingUids));
console.log(
  'Ranking: a semana das 48 contas. Camila em 12º no geral com 4.120 (+2), 12º no Netto e 41º no Nenho.',
);

/** Os claims de uma leva, com o que aconteceu com cada um no log. */
async function claimAll(list) {
  const outcomes = await seedClaims(list);
  list.forEach((invitee, index) => {
    const status = outcomes[index]?.status === 'claimed' ? 'convidado agora' : 'já era convidado';
    console.log(`Convite da Camila: ${invitee.name} (${status}).`);
  });
}

await claimAll(invitees.filter((invitee) => CLAIMS_BEFORE_CATALOG.includes(invitee.email)));

const catalog = await seedMissions();
console.log(
  `Missões: ${catalog ? 'catálogo provisório criado' : 'catálogo já existia'} (5 no ar, meta "Semana do arrocha").`,
);

await claimAll(invitees.filter((invitee) => !CLAIMS_BEFORE_CATALOG.includes(invitee.email)));

const visits = await seedVisits(visitors.map(({ uid, email }) => ({ uid, email })));
visitors.forEach((visitor, index) => {
  const status = visits[index]?.counted ? 'contou agora' : 'já tinha contado';
  console.log(`Visita ao link do clipe da Camila: ${visitor.name} (${status}).`);
});

if (camilaUid) {
  const likes = await seedCamilaLikes(camilaUid);
  console.log(
    `Curtidas da Camila em posts do Nenho: ${likes} agora (2 no total, "Curta 5 posts do Nenho" em 2 de 5).`,
  );
}

const engagement = await seedEngagement(engagementFans);
console.log(
  `Engajamento dos fãs de teste, entrando agora: curtidas ${engagement.likes}, comentários ${engagement.comments}, presenças ${engagement.rsvps}, denúncias ${engagement.reports} (7, 7, 2 e 1 no total).`,
);

if (camilaUid) {
  const shop = await seedCamilaShop(camilaUid);
  console.log(
    `Pedidos da Camila na loja: ${shop.redeemed} novos e ${shop.transitions} mudanças de status agora (4 pedidos no total: entregue, recusado, aprovado e solicitado).`,
  );
}

if (camilaUid) {
  const photo = await seedPhoto(camilaUid);
  console.log(`Foto de teste da Camila: ${photo === 'created' ? 'enviada' : 'já existia'}.`);
}

// --- Telas do painel (bloco 11, 26.13) ---------------------------------------------------

const { SEED_STAFF_ADMIN } = functionsFile('staff/seed');
const staffActor = { uid: SEED_STAFF_ADMIN.uid, name: SEED_STAFF_ADMIN.displayName };

// A foto do fã de propaganda vem antes dos comentários: as cópias nascem com ela.
const { SEED_SPAM_PHOTO_FILE } = functionsBuild('fan-profile');
const spamPhoto = await seedPhoto(fanUids.spam, SEED_SPAM_PHOTO_FILE);
console.log(
  `Foto de teste do Promo Seguidores: ${spamPhoto === 'created' ? 'enviada' : 'já existia'}.`,
);
const { SEED_SUSPENDED_EMAIL, seedModeration, seedSuspension } = functionsBuild('moderation');
const moderation = await withFirestore((db) =>
  seedModeration(db, { spam: fanUids.spam, reporters: [fanUids.bia, fanUids.duda] }, staffActor),
);
console.log(
  `Moderação: ${moderation.comments} comentários de propaganda e ${moderation.reports} denúncias agora (3 e 6 no total), ${moderation.hidden ? 'um ocultado agora' : 'o ocultado já estava'}; a fila tem 3 itens abertos e 1 resolvido.`,
);

const suspendedUid = rankingUids.get(SEED_SUSPENDED_EMAIL);
const suspended = await withFirestore((db) => seedSuspension(db, suspendedUid, staffActor));
console.log(
  `Suspensão: ${SEED_SUSPENDED_EMAIL} ${suspended ? 'suspensa agora' : 'já estava suspensa'} (a api responde 403 a ela).`,
);

const { seedOpenRedemptions } = functionsBuild('rewards');
const openRedemptions = await withFirestore((db) => seedOpenRedemptions(db, rankingUids));
console.log(
  `Pedidos abertos: ${openRedemptions} agora (os ingressos dos rank-01 a rank-04, 4 solicitados no total).`,
);
const { seedGoalReached } = functionsBuild('missions');
const goal = await withFirestore((db) =>
  seedGoalReached(db, rankingUids.get('rank-02@teste.imagineup')),
);
console.log(`Meta da São João: rank-02 ${goal ? 'bateu agora' : 'já tinha batido'} (20 missões).`);

const { seedPanelAudit } = functionsFile('staff/seed');
const audit = await withFirestore((db) => seedPanelAudit(db, { bia: fanUids.bia }));
console.log(`Auditoria de exemplo: ${audit} entradas agora (20 no total, nos últimos 10 dias).`);

// Os números de 60 dias por último, depois de tudo que grava em dias passados.
const statsSeed = functionsFile('points/stats-seed');
const statsNow = Date.now();
const quietLog = { info: () => {}, warn: console.warn, error: console.error };
const stats = await withFirestore(async (db) => {
  const written = await statsSeed.seedPanelStats(db, statsNow);
  const close = await statsSeed.seedPanelClose(db, statsNow, quietLog);
  return {
    written,
    close,
    week: await statsSeed.readClosedTotals(db, statsNow, 7),
    month: await statsSeed.readClosedTotals(db, statsNow, 30),
  };
});
console.log(
  `Números do painel: ${stats.written} dias do seed gravados agora, ${stats.close.closed.length} dias fechados agora (até ${stats.close.lastClosedDay}); hoje fica aberto.`,
);
const number = (value) => (value ?? 0).toLocaleString('pt-BR');
for (const [label, totals] of [
  ['7 dias', stats.week],
  ['30 dias', stats.month],
]) {
  console.log(
    `Fechados, ${label} (${totals.from} a ${totals.to}, ${totals.closedDays} dias): fãs ${number(totals.fans)} no retrato; cadastros ${number(totals.signups)} (${number(totals.invited)} por convite); pontos distribuídos ${number(totals.earned)}; ajustes da equipe ${number(totals.adjustmentPoints)} em ${number(totals.adjustmentEvents)}; ativos por dia ${number(totals.activesAverage)}; curtidas ${number(totals.likes)}, comentários ${number(totals.comments)}, presenças ${number(totals.rsvps)}, denúncias ${number(totals.reports)}; entradas nas centrais ${number(totals.joined)}; pedidos ${number(totals.redeemRequested)}, gastos ${number(totals.redeemSpent)}, devolvidos ${number(totals.refunded)}, entregues ${number(totals.redeemDelivered)}.`,
  );
}
