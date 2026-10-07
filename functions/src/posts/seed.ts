import { Timestamp, type Firestore } from 'firebase-admin/firestore';

import { runRsvp } from '../agenda/service';
import { runReport } from '../moderation/service';
import { createConfigSource, DEFAULT_POINTS_CONFIG } from '../points/config';
import { NO_GAME, type PointsConfig } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import type { PostKind } from './model';
import { runComment, runLikePost } from './service';
import { postRef } from './store';

// O mural de teste no seed dos emuladores (scripts/seed-emulators.mjs, que
// carrega este build): os 10 posts de exemplo do app (src/domains/posts/
// fixtures.ts), com os mesmos ids, tipos, centrais e textos, publicados como
// o painel publicaria, e o engajamento dos fãs de teste pelos mesmos núcleos
// das rotas. Nunca roda em produção: o script fixa o emulador.
// docs/arquitetura-api.md, 21.14.

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

type SeedPost = {
  id: string;
  kind: PostKind;
  artistId: string;
  text: string;
  hoursAgo: number;
  eventId: string | null;
  status: 'draft' | 'published';
};

export const SEED_POSTS: readonly SeedPost[] = [
  {
    id: 'p-clipe',
    kind: 'video',
    artistId: 'nettobrito',
    text: 'Saiu o clipe de “Sonho de Amor”, gravado no São João de Irará.',
    hoursAgo: 2,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-show',
    kind: 'event',
    artistId: 'nenho',
    text: 'Sábado tem show em Aracaju! Quem vem?',
    hoursAgo: 5,
    eventId: 'arrocha-na-praia',
    status: 'published',
  },
  {
    id: 'p-g1',
    kind: 'photo',
    artistId: 'nettobrito',
    text: 'Ensaio de hoje pro São João. Quem vai estar lá?',
    hoursAgo: 27,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-g2',
    kind: 'photo',
    artistId: 'nettobrito',
    text: 'Bastidores do clipe novo. Foram três dias de gravação em Irará.',
    hoursAgo: 2 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-g3',
    kind: 'photo',
    artistId: 'nettobrito',
    text: 'Obrigado, Feira de Santana! Que noite.',
    hoursAgo: 3 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-texto',
    kind: 'text',
    artistId: 'nettobrito',
    text: 'Tem música nova chegando. Chuta o nome aí nos comentários.',
    hoursAgo: 4 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-juninho-1',
    kind: 'photo',
    artistId: 'juninhomoraes',
    text: 'Primeira semana com a central aberta. Bora fazer barulho!',
    hoursAgo: 6 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-nenho-2',
    kind: 'video',
    artistId: 'nenho',
    text: 'Um pedaço do ensaio de ontem. Qual música vocês querem no show?',
    hoursAgo: 8 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-netto-4',
    kind: 'photo',
    artistId: 'nettobrito',
    text: 'Chegando em Irará.',
    hoursAgo: 10 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-nenho-3',
    kind: 'text',
    artistId: 'nenho',
    text: 'Valeu por cada mensagem desta semana. Tô lendo tudo.',
    hoursAgo: 13 * 24,
    eventId: null,
    status: 'published',
  },
  {
    // Os dois posts do Nenho que a Camila já curtiu (bloco 7, 22.13): o "2 de
    // 5" da "Curta 5 posts do Nenho". Os mesmos das fixtures do app.
    id: 'p-nenho-4',
    kind: 'photo',
    artistId: 'nenho',
    text: 'Ensaio aberto em Aracaju. Obrigado a quem foi!',
    hoursAgo: 15 * 24,
    eventId: null,
    status: 'published',
  },
  {
    id: 'p-nenho-5',
    kind: 'text',
    artistId: 'nenho',
    text: 'Gravando coisa nova no estúdio. Em breve!',
    hoursAgo: 16 * 24,
    eventId: null,
    status: 'published',
  },
  {
    // Rascunho: o app não mostra.
    id: 'p-rascunho',
    kind: 'text',
    artistId: 'nettobrito',
    text: 'Rascunho de um post que ainda não foi ao ar.',
    hoursAgo: 1,
    eventId: null,
    status: 'draft',
  },
];

/**
 * Cria cada post que ainda não existe, no formato das callables, sem a
 * conferência de mídia e sem auditoria: foto e vídeo saem publicados sem
 * mídia (o painel não consegue, `missing-media`), e a resposta manda a mídia
 * com as URLs nulas e as medidas padrão, como as fixtures. O `publishedAt` é o
 * "há N horas" de hoje. Devolve quantos criou.
 */
export async function seedPosts(db: Firestore, now: number = Date.now()): Promise<number> {
  let created = 0;
  for (const post of SEED_POSTS) {
    const ref = postRef(db, post.id);
    const at = Timestamp.fromMillis(now - post.hoursAgo * HOUR_MS);
    created += await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) return 0;
      tx.create(ref, {
        artistId: post.artistId,
        kind: post.kind,
        text: post.text,
        media: null,
        eventId: post.eventId,
        status: post.status,
        publishedAt: post.status === 'published' ? at : null,
        likeCount: 0,
        commentCount: 0,
        countsAt: null,
        createdAt: at,
        updatedAt: at,
        createdBy: 'seed',
        updatedBy: 'seed',
        schemaVersion: 1,
      });
      return 1;
    });
  }
  return created;
}

/** Os fãs de teste do engajamento, pelo nome curto. */
export type SeedFanKey = 'alan' | 'bia' | 'duda' | 'enzo';

type SeedComment = {
  id: string;
  fan: SeedFanKey;
  postId: string;
  minutesAgo: number;
  text: string;
};

/**
 * O engajamento dos fãs de teste (a Camila fica de fora, como o estado
 * inicial das fixtures: a primeira ação dela no app mostra os pontos do
 * servidor). A fila copia as contagens em segundos: o clipe fica com 3
 * curtidas e 4 comentários, e o show com 2 e 2.
 */
export const SEED_ENGAGEMENT: {
  likes: readonly { fan: SeedFanKey; postId: string }[];
  comments: readonly SeedComment[];
  rsvps: readonly { fan: SeedFanKey; eventId: string }[];
  reports: readonly { fan: SeedFanKey; postId: string; commentId: string; reason: 'spam' }[];
} = {
  likes: [
    { fan: 'bia', postId: 'p-clipe' },
    { fan: 'duda', postId: 'p-clipe' },
    { fan: 'enzo', postId: 'p-clipe' },
    { fan: 'bia', postId: 'p-show' },
    { fan: 'enzo', postId: 'p-show' },
    { fan: 'alan', postId: 'p-g1' },
    { fan: 'duda', postId: 'p-nenho-2' },
  ],
  comments: [
    {
      id: 'seed-c-clipe-bia',
      fan: 'bia',
      postId: 'p-clipe',
      minutesAgo: 60,
      text: 'Já mandei pro grupo da família inteira, Irará em peso! 💃',
    },
    {
      id: 'seed-c-clipe-duda',
      fan: 'duda',
      postId: 'p-clipe',
      minutesAgo: 66,
      text: 'Esse clipe ficou lindo demais. Já vi umas dez vezes.',
    },
    {
      id: 'seed-c-clipe-enzo',
      fan: 'enzo',
      postId: 'p-clipe',
      minutesAgo: 73,
      text: 'Irará nunca mais vai ser a mesma depois desse São João.',
    },
    {
      id: 'seed-c-clipe-alan',
      fan: 'alan',
      postId: 'p-clipe',
      minutesAgo: 95,
      text: 'Que música boa demais!',
    },
    {
      id: 'seed-c-show-bia',
      fan: 'bia',
      postId: 'p-show',
      minutesAgo: 120,
      text: 'Chama que a Bahia vai em peso!',
    },
    {
      id: 'seed-c-show-enzo',
      fan: 'enzo',
      postId: 'p-show',
      minutesAgo: 180,
      text: 'Promoção de ingresso no meu perfil, chama no privado!!!',
    },
    {
      id: 'seed-c-texto-duda',
      fan: 'duda',
      postId: 'p-texto',
      minutesAgo: 20 * 60,
      text: 'Aposto em Sonho de Verão!',
    },
  ],
  rsvps: [
    { fan: 'bia', eventId: 'arrocha-na-praia' },
    { fan: 'duda', eventId: 'sao-joao-irara' },
  ],
  reports: [{ fan: 'alan', postId: 'p-show', commentId: 'seed-c-show-enzo', reason: 'spam' }],
};

/**
 * Curtir, comentar e "Eu vou" em 0 no seed, como o `central_join: 0` do bloco
 * 4 e o convite do bloco 5: o padrão paga 2 por comentário, e os comentários
 * do seed criariam a carteira do Alan. Assim nenhuma carteira muda.
 */
export const SEED_ENGAGEMENT_CONFIG: PointsConfig = {
  ...DEFAULT_POINTS_CONFIG,
  values: { ...DEFAULT_POINTS_CONFIG.values, like: 0, comment: 0, rsvp: 0 },
};

export type SeedEngagementResult = {
  likes: number;
  comments: number;
  rsvps: number;
  reports: number;
};

/**
 * O engajamento dos fãs de teste pelos mesmos núcleos das rotas (curtir,
 * comentar, "Eu vou" e denunciar), com o ator de sistema (não conta nos tetos
 * nem marca atividade) e o `SEED_ENGAGEMENT_CONFIG`. Fã que falta no mapa
 * fica de fora. Rodar de novo não muda nada: cada núcleo devolve sem efeito.
 * Devolve quantos de cada ação entraram agora.
 */
export async function seedEngagement(
  db: Firestore,
  fans: Partial<Record<SeedFanKey, string>>,
  now: number = Date.now(),
): Promise<SeedEngagementResult> {
  // Sem o jogo (22.13): o engajamento dos fãs de teste não anda missão nem
  // desbloqueia conquista, e o Alan continua sem carteira.
  const options = { now, config: SEED_ENGAGEMENT_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  const result: SeedEngagementResult = { likes: 0, comments: 0, rsvps: 0, reports: 0 };
  for (const like of SEED_ENGAGEMENT.likes) {
    const uid = fans[like.fan];
    if (!uid) continue;
    const before = await db
      .collection('users')
      .doc(uid)
      .collection('postLikes')
      .doc(like.postId)
      .get();
    await runLikePost(db, uid, like.postId, options);
    if (before.get('liked') !== true) result.likes += 1;
  }
  for (const comment of SEED_ENGAGEMENT.comments) {
    const uid = fans[comment.fan];
    if (!uid) continue;
    const outcome = await runComment(
      db,
      uid,
      { postId: comment.postId, text: comment.text, commentId: comment.id },
      { ...options, now: now - comment.minutesAgo * MINUTE_MS },
    );
    if (outcome.comment) result.comments += 1;
  }
  for (const rsvp of SEED_ENGAGEMENT.rsvps) {
    const uid = fans[rsvp.fan];
    if (!uid) continue;
    const before = await db
      .collection('users')
      .doc(uid)
      .collection('eventRsvps')
      .doc(rsvp.eventId)
      .get();
    await runRsvp(db, uid, rsvp.eventId, options);
    if (before.get('going') !== true) result.rsvps += 1;
  }
  for (const report of SEED_ENGAGEMENT.reports) {
    const uid = fans[report.fan];
    if (!uid) continue;
    const outcome = await runReport(
      db,
      uid,
      { postId: report.postId, commentId: report.commentId, reason: report.reason },
      options,
    );
    if (outcome.status === 'reported') result.reports += 1;
  }
  return result;
}

/** Os posts do Nenho que a Camila curte no seed (bloco 7, 22.13). */
export const CAMILA_SEED_LIKES: readonly string[] = ['p-nenho-4', 'p-nenho-5'];

/**
 * As curtidas da Camila em `p-nenho-4` e `p-nenho-5`, pelo mesmo núcleo da
 * rota (runLikePost), com ator de sistema, curtir valendo 0 (nenhum
 * lançamento) e o jogo lido agora: a "Curta 5 posts do Nenho" fica em 2 de 5,
 * como no protótipo, e a carteira só ganha o progresso. Rodar de novo não
 * conta: os posts já estão curtidos. Devolve quantas curtidas entraram agora.
 */
export async function seedCamilaLikes(
  db: Firestore,
  uid: string,
  now: number = Date.now(),
): Promise<number> {
  const { game } = await createConfigSource(db, { ttlMs: 0 }).get();
  let liked = 0;
  for (const postId of CAMILA_SEED_LIKES) {
    const before = await db.collection('users').doc(uid).collection('postLikes').doc(postId).get();
    await runLikePost(db, uid, postId, {
      now,
      config: SEED_ENGAGEMENT_CONFIG,
      actor: SEED_ACTOR,
      game,
    });
    if (before.get('liked') !== true) liked += 1;
  }
  return liked;
}
