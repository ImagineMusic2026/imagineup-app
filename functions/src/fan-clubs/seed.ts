import type { Firestore } from 'firebase-admin/firestore';

import { membershipRef, runJoinCentrals } from '../centrals/service';
import type { FanPhotoFiles } from '../fan-profile/files';
import { parseLinkId } from '../invites/model';
import { runInviteLinks } from '../invites/service';
import { DEFAULT_POINTS_CONFIG } from '../points/config';
import { NO_GAME } from '../points/model';
import { SEED_ACTOR } from '../points/seed';
import { SEED_PRIZE_REWARD, seedPrizeReward } from '../rewards/seed';
import { runAddFanClubComment } from './comments';
import { copyFanClubCount } from './copy';
import { runFollowFanClub } from './follows';
import {
  applicationRecord,
  fanClubPostRecord,
  type ApplicationInput,
  type FanClubReactionKey,
  type RewardGrantInput,
} from './model';
import { runFanClubDecision } from './panel';
import { runCreateFanClubPost, runOpenFanClubUpload } from './posts';
import { runSetFanClubReaction } from './reactions';
import { runReportFanClubPost } from './reports';
import { runApplyForFanClub } from './service';
import {
  applicationRef,
  fanClubCommentRef,
  fanClubFollowRef,
  fanClubPostsOfAuthor,
  fanClubPrizeRef,
  fanClubReactionRef,
  fanClubRef,
  fanClubReportQueueRef,
} from './store';

// O fã-clube no seed dos emuladores (docs/arquitetura-api.md, 34.12), pelos
// núcleos de verdade. Na etapa 1 de 34.14: a Camila, gestora aprovada do
// fã-clube do Netto (a candidatura com o ator de sistema, que não conta no
// teto, com o WhatsApp de teste no contato dela, e a aprovação com o admin do
// seed), e o Nenho com o `photosAllowed: false` gravado (os fã-clubes dele só
// publicam texto). O Netto fica com as caixas pelo padrão (o
// `imageRightsConfirmed`). Na etapa 2: as três publicações da Camila (duas no
// ar, uma com a foto de teste em 4:5, e uma em análise) e a denúncia da Bia
// contra a da foto, com "Uso indevido de imagem". Na etapa 3: o link do
// fã-clube que a Camila compartilhou (`fanclub:<id>`), para os números do
// fã-clube terem um link. Na etapa 4: os seguidores (a Bia, da central, e uma
// conta do ranking que entra junto, a entrada trazida) e a primeira cópia da
// noite. Na etapa 5: a recompensa "Só para prêmios" e o prêmio da Camila, com
// os pontos. Na etapa 10: a candidatura pendente da Duda para o Nenho, para a
// fila do painel e o "Candidatura em análise" do app (34.22). Desde 34.23, o
// fã-clube da Camila oficializado pelo admin do seed, junto da aprovação (o
// selo de oficial; o da Duda, quando aprovado no painel local, fica sem ele).
// Na Fase 2 (seção 37, etapa 1 de 37.13): os comentários e as reações nas duas
// publicações no ar da Camila, com a resposta dela com o @ da Bia.
// Rodar de novo não muda nada. Nunca roda em produção: o script fixa os emuladores.

/** A central com as fotos de fã desligadas (só texto). */
export const SEED_TEXT_ONLY_ARTIST = 'nenho';

/**
 * A candidatura da Camila (as redes de exemplo do perfil dela, 28.10), com um
 * WhatsApp de teste no molde dos pedidos abertos do seed da loja (seção 35).
 */
export const SEED_CAMILA_FAN_CLUB: ApplicationInput = {
  artistId: 'nettobrito',
  name: 'Netto de Coração',
  instagram: 'camila.teste.up',
  tiktok: 'camila.teste.up',
  whatsapp: '+5575900000010',
  pitch:
    'Divulgo o Netto nos stories e no grupo dos fãs de Irará, levo a turma aos shows e ' +
    'compartilho os clipes no dia do lançamento.',
};

export type SeedFanClubsResult = {
  /** O Nenho ganhou o `photosAllowed: false` agora. */
  textOnly: boolean;
  /** A candidatura da Camila entrou agora. */
  applied: boolean;
  /** A candidatura da Camila foi aprovada agora. */
  approved: boolean;
  /** O fã-clube da Camila foi oficializado agora (34.23). */
  officialized: boolean;
};

/**
 * O seed do fã-clube: o Nenho só com texto e a Camila aprovada, com o
 * fã-clube oficializado. Cada passo só roda quando o que ele cria ainda não
 * existe: a candidatura só nasce sem nenhuma, a aprovação só vai com ela
 * pendente (a recusada ou retirada no painel local fica como está), e o selo
 * só entra junto da aprovação (o tirado no painel local fica como está).
 */
export async function seedFanClubs(
  db: Firestore,
  camilaUid: string,
  actor: { uid: string; name: string },
  now: number = Date.now(),
): Promise<SeedFanClubsResult> {
  const result: SeedFanClubsResult = {
    textOnly: false,
    applied: false,
    approved: false,
    officialized: false,
  };
  const textOnly = db.collection('artistPrivate').doc(SEED_TEXT_ONLY_ARTIST);
  const privateDoc = await textOnly.get();
  if (!privateDoc.exists) throw new Error(`Falta a central ${SEED_TEXT_ONLY_ARTIST} do seed.`);
  if (privateDoc.get('fanClubs.photosAllowed') !== false) {
    await textOnly.set({ fanClubs: { photosAllowed: false } }, { merge: true });
    result.textOnly = true;
  }

  const options = { now, config: DEFAULT_POINTS_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  let application = await applicationRef(db, camilaUid).get();
  if (!application.exists) {
    await runApplyForFanClub(db, camilaUid, SEED_CAMILA_FAN_CLUB, options);
    result.applied = true;
    application = await applicationRef(db, camilaUid).get();
  }
  const record = applicationRecord(camilaUid, application.data() ?? {});
  if (record.status === 'pending') {
    await runFanClubDecision(
      db,
      {
        subject: 'application',
        id: camilaUid,
        decision: 'approve',
        expected: record.round,
        submittedAt: record.submittedAt,
        name: null,
      },
      { actor, now },
    );
    result.approved = true;
    const approved = applicationRecord(
      camilaUid,
      (await applicationRef(db, camilaUid).get()).data() ?? {},
    );
    if (approved.clubId !== null) {
      await runFanClubDecision(
        db,
        { subject: 'club', id: approved.clubId, decision: 'officialize', expected: 'active' },
        { actor, now },
      );
      result.officialized = true;
    }
  }
  return result;
}

/** Uma publicação do seed: o texto, se leva a foto de teste e se a equipe a aprova. */
export type SeedFanClubPost = { text: string; photo: boolean; publish: boolean };

/** As publicações da Camila, na ordem em que nascem (duas no ar e uma em análise). */
export const SEED_FAN_CLUB_POSTS: readonly SeedFanClubPost[] = [
  {
    text: 'O ensaio de hoje foi lindo! Quem vem com a gente no show de sábado em Irará?',
    photo: true,
    publish: true,
  },
  {
    text: 'Contagem regressiva para o lançamento do clipe novo: faltam 3 dias. Bora assistir juntos!',
    photo: false,
    publish: true,
  },
  {
    text: 'Fizemos uma faixa para o próximo show. Quem quer ajudar a pintar no domingo?',
    photo: false,
    publish: false,
  },
];

export type SeedFanClubPostsResult = {
  /** Publicações criadas agora. */
  created: number;
  /** Publicações aprovadas agora. */
  published: number;
  /** A denúncia da Bia entrou agora. */
  reported: boolean;
};

/**
 * As publicações da Camila e a denúncia da Bia (34.12, etapa 2), pelos núcleos
 * de verdade: a vaga, os dois arquivos da foto de teste em 4:5 (`save`, como o
 * app enviaria) e a publicação com o ator de sistema (os tetos não contam), e
 * a aprovação com o admin do seed. Cada publicação só nasce quando a Camila
 * ainda não tem uma com o mesmo texto, e só é aprovada quando está em análise
 * e o seed a quer no ar (a recusada ou retirada no painel local fica como
 * está). A denúncia só vai sem o item da publicação da foto na fila.
 */
export async function seedFanClubPosts(
  db: Firestore,
  files: FanPhotoFiles,
  save: (path: string, data: Uint8Array) => Promise<void>,
  input: {
    camilaUid: string;
    biaUid: string;
    actor: { uid: string; name: string };
    photo: Uint8Array;
    thumb: Uint8Array;
  },
  now: number = Date.now(),
): Promise<SeedFanClubPostsResult> {
  const result: SeedFanClubPostsResult = { created: 0, published: 0, reported: false };
  const options = { now, config: DEFAULT_POINTS_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  const existing = await fanClubPostsOfAuthor(db, input.camilaUid).get();
  const byText = new Map(
    existing.docs.map((doc) => [
      doc.get('text'),
      { id: doc.id, status: fanClubPostRecord(doc.id, doc.data()).status as string },
    ]),
  );
  let photoPost: { id: string; status: string } | null = null;
  for (const item of SEED_FAN_CLUB_POSTS) {
    let post = byText.get(item.text) ?? null;
    if (post === null) {
      if (item.photo) {
        const { body: slot } = await runOpenFanClubUpload(db, input.camilaUid, options);
        await save(slot.photoPath, input.photo);
        await save(slot.thumbPath, input.thumb);
      }
      const { body } = await runCreateFanClubPost(
        db,
        files,
        input.camilaUid,
        { text: item.text, photo: item.photo },
        options,
      );
      result.created += 1;
      post = { id: body.id, status: body.status };
    }
    if (item.publish && post.status === 'pending') {
      const decided = await runFanClubDecision(
        db,
        { subject: 'post', id: post.id, decision: 'approve', expected: 'pending' },
        { actor: input.actor, now, files },
      );
      result.published += 1;
      post = { id: post.id, status: decided.status };
    }
    if (item.photo) photoPost = post;
  }
  // Só a publicação no ar se denuncia (a recusada no painel local fica sem).
  if (
    photoPost?.status === 'published' &&
    !(await fanClubReportQueueRef(db, photoPost.id).get()).exists
  ) {
    await runReportFanClubPost(
      db,
      input.biaUid,
      { postId: photoPost.id, reason: 'image_misuse' },
      options,
    );
    result.reported = true;
  }
  return result;
}

/**
 * O link do fã-clube da Camila (34.12, etapa 3 de 34.14), pelo núcleo de
 * verdade do `PUT /me/invite/links/:linkId` (`runInviteLinks`, com o ator de
 * sistema, fora do teto), como o "Compartilhar meu fã-clube" faria: o link
 * `fanclub:<id>` e +1 nos links do fã-clube. Pede o fã-clube ativo dela e o
 * código de convite (o `seedCamilaInvite`, antes); o link que já existe não
 * conta de novo. Devolve se o link nasceu agora.
 */
export async function seedFanClubLink(
  db: Firestore,
  camilaUid: string,
  now: number = Date.now(),
): Promise<boolean> {
  const application = await applicationRef(db, camilaUid).get();
  const clubId = application.exists
    ? applicationRecord(camilaUid, application.data() ?? {}).clubId
    : null;
  const link = clubId === null ? null : parseLinkId(`fanclub:${clubId}`);
  if (link === null) return false;
  const options = { now, config: DEFAULT_POINTS_CONFIG, actor: SEED_ACTOR, game: NO_GAME };
  return (await runInviteLinks(db, camilaUid, [link], options)) > 0;
}

/** A conta do ranking que segue o fã-clube da Camila sem ser da central do Netto (34.12). */
export const SEED_FAN_CLUB_FOLLOWER = 'rank-40@teste.imagineup';

export type SeedFanClubFollowsResult = {
  /** A Bia entrou agora na central do Netto, antes de seguir. */
  joined: boolean;
  /** Seguimentos gravados agora (a Bia e a conta do ranking: 2 no total). */
  follows: number;
  /** A cópia da noite do fã-clube rodou agora (só sem cópia ainda). */
  copied: boolean;
};

/**
 * Os seguidores do fã-clube da Camila (34.12, etapa 4 de 34.14), pelos
 * núcleos de verdade, com o ator de sistema (os tetos não contam) e o
 * `central_join` em 0, como a base do ranking (os pontos e as posições do
 * seed não mudam): a Bia, que já é da central (entra antes pela página, se
 * falta), segue; a conta do ranking, que não é da central, segue e entra
 * junto, e a entrada creditada aparece em "entradas trazidas" (o crédito do
 * seguir). Depois, a cópia da noite do fã-clube, só sem cópia ainda
 * (`counts.at` nulo), para a lista e a ficha do painel terem os números.
 * Cada passo só roda quando o que ele cria falta: rodar de novo não muda nada.
 */
export async function seedFanClubFollows(
  db: Firestore,
  input: { camilaUid: string; biaUid: string; followerUid: string },
  now: number = Date.now(),
): Promise<SeedFanClubFollowsResult> {
  const result: SeedFanClubFollowsResult = { joined: false, follows: 0, copied: false };
  const application = await applicationRef(db, input.camilaUid).get();
  const clubId = application.exists
    ? applicationRecord(input.camilaUid, application.data() ?? {}).clubId
    : null;
  if (clubId === null) return result;
  const club = await fanClubRef(db, clubId).get();
  const artistId = club.get('artistId');
  if (typeof artistId !== 'string') return result;
  const options = {
    now,
    config: {
      ...DEFAULT_POINTS_CONFIG,
      values: { ...DEFAULT_POINTS_CONFIG.values, central_join: 0 },
    },
    actor: SEED_ACTOR,
    game: NO_GAME,
  };
  if (!(await fanClubFollowRef(db, input.biaUid, clubId).get()).exists) {
    if (!(await membershipRef(db, input.biaUid, artistId).get()).exists) {
      await runJoinCentrals(db, input.biaUid, [artistId], { ...options, via: 'page' });
      result.joined = true;
    }
    await runFollowFanClub(db, input.biaUid, clubId, options);
    result.follows += 1;
  }
  if (!(await fanClubFollowRef(db, input.followerUid, clubId).get()).exists) {
    await runFollowFanClub(db, input.followerUid, clubId, options);
    result.follows += 1;
  }
  if ((await fanClubRef(db, clubId).get()).get('counts.at') === null) {
    await copyFanClubCount(db, clubId, now);
    result.copied = true;
  }
  return result;
}

/** Quem reage e comenta no seed da Fase 2: a Bia, a conta do ranking que segue e a gestora. */
export type SeedFanClubActor = 'bia' | 'follower' | 'camila';

/**
 * Um comentário do seed da Fase 2 (seção 37, 37.13): o id fixo, quem comenta,
 * a publicação no ar da Camila pela ordem do `SEED_FAN_CLUB_POSTS` (0, a da
 * foto; 1, a de texto), há quantos minutos e o comentário respondido. A
 * resposta da Camila começa pelo @ da Bia (R7); a marcação vira link na
 * etapa 2.
 */
export type SeedFanClubComment = {
  id: string;
  author: SeedFanClubActor;
  post: 0 | 1;
  minutesAgo: number;
  text: string;
  replyTo: string | null;
};

/** Os comentários do seed, na ordem em que nascem (a resposta depois do respondido). */
export const SEED_FAN_CLUB_COMMENTS: readonly SeedFanClubComment[] = [
  {
    id: 'seed-fa-clube-bia-1',
    author: 'bia',
    post: 0,
    minutesAgo: 50,
    text: 'Que ensaio lindo! Já estou contando os dias para sábado.',
    replyTo: null,
  },
  {
    id: 'seed-fa-clube-seguidor-1',
    author: 'follower',
    post: 0,
    minutesAgo: 40,
    text: 'Vou com a turma do bairro, guarda um lugar para a gente!',
    replyTo: null,
  },
  {
    id: 'seed-fa-clube-camila-1',
    author: 'camila',
    post: 0,
    minutesAgo: 30,
    text: 'Te espero na frente do palco!',
    replyTo: 'seed-fa-clube-bia-1',
  },
  {
    id: 'seed-fa-clube-bia-2',
    author: 'bia',
    post: 1,
    minutesAgo: 20,
    text: 'Bora! Vou assistir no dia do lançamento.',
    replyTo: null,
  },
  {
    id: 'seed-fa-clube-seguidor-2',
    author: 'follower',
    post: 1,
    minutesAgo: 10,
    text: 'Já salvei o lembrete do clipe.',
    replyTo: null,
  },
];

/** As reações do seed: a Bia nas duas, a conta do ranking na da foto e a Camila na dela. */
export const SEED_FAN_CLUB_REACTIONS: readonly {
  author: SeedFanClubActor;
  post: 0 | 1;
  reaction: FanClubReactionKey;
}[] = [
  { author: 'bia', post: 0, reaction: 'heart' },
  { author: 'bia', post: 1, reaction: 'fire' },
  { author: 'follower', post: 0, reaction: 'clap' },
  { author: 'camila', post: 0, reaction: 'heart' },
];

export type SeedFanClubEngagementResult = {
  /** Comentários gravados agora (5 no total, com a resposta da Camila). */
  comments: number;
  /** Reações gravadas agora (4 no total). */
  reactions: number;
};

/**
 * Os comentários e as reações nas duas publicações no ar da Camila (seção 37,
 * 37.13, o seed da etapa 1), pelos núcleos de verdade, com o ator de sistema
 * (os tetos não contam) e a configuração padrão (as duas origens valem 0):
 * os comentários da Bia e da conta do ranking que segue, a resposta da Camila
 * com o @ da Bia e as reações dos três. Cada comentário tem o id fixo e só
 * nasce quando falta (e a resposta, só com o respondido visível); cada reação
 * só vai sem o documento dela (a trocada no app local fica como está). A
 * publicação em análise não recebe nada, e a que saiu do ar no painel local
 * fica sem. Depois do `seedFanClubFollows`: comentar e reagir pedem seguir.
 */
export async function seedFanClubEngagement(
  db: Firestore,
  input: { camilaUid: string; biaUid: string; followerUid: string },
  now: number = Date.now(),
): Promise<SeedFanClubEngagementResult> {
  const result: SeedFanClubEngagementResult = { comments: 0, reactions: 0 };
  const application = await applicationRef(db, input.camilaUid).get();
  const clubId = application.exists
    ? applicationRecord(input.camilaUid, application.data() ?? {}).clubId
    : null;
  if (clubId === null) return result;
  if ((await fanClubRef(db, clubId).get()).get('status') !== 'active') return result;
  const existing = await fanClubPostsOfAuthor(db, input.camilaUid).get();
  const byText = new Map(
    existing.docs.map((doc) => [doc.get('text'), fanClubPostRecord(doc.id, doc.data())]),
  );
  const posts = SEED_FAN_CLUB_POSTS.filter((item) => item.publish).map((item) => {
    const post = byText.get(item.text);
    return post?.status === 'published' ? post : null;
  });
  const uids: Record<SeedFanClubActor, string> = {
    bia: input.biaUid,
    follower: input.followerUid,
    camila: input.camilaUid,
  };
  const biaUsername = (await db.collection('users').doc(input.biaUid).get()).get('username');
  const options = { now, config: DEFAULT_POINTS_CONFIG, actor: SEED_ACTOR, game: NO_GAME };

  for (const item of SEED_FAN_CLUB_COMMENTS) {
    const post = posts[item.post];
    if (!post || (await fanClubCommentRef(db, item.id).get()).exists) continue;
    if (item.replyTo !== null) {
      const replied = await fanClubCommentRef(db, item.replyTo).get();
      if (!replied.exists || replied.get('status') !== 'visible') continue;
    }
    const text =
      item.replyTo !== null && typeof biaUsername === 'string' && biaUsername !== ''
        ? `@${biaUsername} ${item.text}`
        : item.text;
    const { comment } = await runAddFanClubComment(
      db,
      uids[item.author],
      { postId: post.id, text, replyToId: item.replyTo, commentId: item.id },
      { ...options, now: now - item.minutesAgo * 60_000 },
    );
    if (comment) result.comments += 1;
  }
  for (const item of SEED_FAN_CLUB_REACTIONS) {
    const post = posts[item.post];
    const uid = uids[item.author];
    if (!post || (await fanClubReactionRef(db, uid, post.id).get()).exists) continue;
    await runSetFanClubReaction(db, uid, { postId: post.id, reaction: item.reaction }, options);
    result.reactions += 1;
  }
  return result;
}

/**
 * O prêmio dado à Camila (34.12, etapa 5 de 34.14): 200 pontos, só no saldo,
 * e o ingresso de cortesia da recompensa "Só para prêmios" do seed, com o
 * cupom e a mensagem, para a fileira "Seus prêmios", o card Prêmios e o
 * extrato com "Prêmio do fã-clube". O `grantId` é fixo: rodar de novo acha o
 * registro com os mesmos campos e não grava.
 */
export const SEED_FAN_CLUB_GRANT: RewardGrantInput = {
  grantId: 'seed-camila-cortesia',
  points: 200,
  prize: {
    rewardId: SEED_PRIZE_REWARD.id,
    delivered: false,
    coupon: 'CORTESIA-IRARA',
    message: 'Obrigado por levar a turma de Irará aos shows do Netto!',
  },
  note: 'Seed: o fã-clube que mais divulgou o São João de Irará.',
};

export type SeedFanClubPrizeResult = {
  /** A recompensa "Só para prêmios" nasceu agora. */
  reward: boolean;
  /** O prêmio foi dado agora. */
  granted: boolean;
};

/**
 * A recompensa "Só para prêmios" (só quando falta) e o prêmio da Camila, pelo
 * núcleo do Recompensar da `decideFanClub` com o admin do seed (sem conferir
 * o acesso nem o teto do papel), só com o fã-clube dela ativo e sem o
 * registro: rodar de novo não muda nada.
 */
export async function seedFanClubPrize(
  db: Firestore,
  input: { camilaUid: string; actor: { uid: string; name: string } },
  now: number = Date.now(),
): Promise<SeedFanClubPrizeResult> {
  const result: SeedFanClubPrizeResult = { reward: false, granted: false };
  result.reward = await seedPrizeReward(db, now);
  const application = await applicationRef(db, input.camilaUid).get();
  const clubId = application.exists
    ? applicationRecord(input.camilaUid, application.data() ?? {}).clubId
    : null;
  if (clubId === null) return result;
  const club = await fanClubRef(db, clubId).get();
  if (club.get('status') !== 'active') return result;
  if ((await fanClubPrizeRef(db, clubId, SEED_FAN_CLUB_GRANT.grantId).get()).exists) return result;
  await runFanClubDecision(
    db,
    {
      subject: 'club',
      id: clubId,
      decision: 'reward',
      expected: 'active',
      grant: SEED_FAN_CLUB_GRANT,
    },
    { actor: input.actor, now, config: DEFAULT_POINTS_CONFIG, role: 'admin' },
  );
  result.granted = true;
  return result;
}

/**
 * A candidatura da Duda para o Nenho (34.12), com redes e WhatsApp de teste
 * (o perfil dela não tem redes, 28.10). O Nenho só aceita texto: o fã-clube,
 * se a equipe aprovar no painel local, publica sem foto.
 */
export const SEED_DUDA_FAN_CLUB: ApplicationInput = {
  artistId: SEED_TEXT_ONLY_ARTIST,
  name: 'Turma do Nenho',
  instagram: 'duda.teste.up',
  tiktok: null,
  whatsapp: '+5575900000011',
  pitch:
    'Junto a turma de Alagoinhas para ouvir os lançamentos do Nenho e divulgo os shows ' +
    'no grupo da faculdade.',
};

export type SeedFanClubPendingResult = {
  /** A Duda entrou agora na central do Nenho, antes da candidatura. */
  joined: boolean;
  /** A candidatura da Duda entrou agora. */
  applied: boolean;
};

/**
 * A candidatura pendente da Duda (34.12, etapa 10 de 34.14), para a fila das
 * candidaturas do painel e o "Candidatura em análise" do "Meu fã-clube" do app. Só
 * quem é da central se candidata (decisão 8): a Duda, que não era de central
 * nenhuma, entra antes no Nenho pela página, pelo núcleo da entrada, com o
 * ator de sistema e o `central_join` em 0, como os seguidores (os pontos e as
 * posições do seed não mudam; o fã-clube da Camila, que a trouxe, é do Netto,
 * e a entrada no Nenho não leva crédito). A candidatura só nasce sem nenhuma da
 * Duda (a recusada ou aprovada no painel local fica como está): rodar de novo
 * não muda nada.
 */
export async function seedFanClubPending(
  db: Firestore,
  dudaUid: string,
  now: number = Date.now(),
): Promise<SeedFanClubPendingResult> {
  const result: SeedFanClubPendingResult = { joined: false, applied: false };
  if ((await applicationRef(db, dudaUid).get()).exists) return result;
  const options = {
    now,
    config: {
      ...DEFAULT_POINTS_CONFIG,
      values: { ...DEFAULT_POINTS_CONFIG.values, central_join: 0 },
    },
    actor: SEED_ACTOR,
    game: NO_GAME,
  };
  if (!(await membershipRef(db, dudaUid, SEED_DUDA_FAN_CLUB.artistId).get()).exists) {
    await runJoinCentrals(db, dudaUid, [SEED_DUDA_FAN_CLUB.artistId], { ...options, via: 'page' });
    result.joined = true;
  }
  await runApplyForFanClub(db, dudaUid, SEED_DUDA_FAN_CLUB, options);
  result.applied = true;
  return result;
}
