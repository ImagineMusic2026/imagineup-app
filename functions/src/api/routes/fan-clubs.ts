import { isArtistId } from '../../centrals/model';
import {
  acceptFanClubRules,
  addFanClubComment,
  applyForFanClub,
  ARTIST_FAN_CLUBS_PAGE,
  clearFanClubReaction,
  createFanClubPost,
  FAN_CLUB_COMMENTS_PAGE,
  FAN_CLUB_POSTS_PAGE,
  fanClubCommentNotFound,
  followFanClub,
  hideFanClubComment,
  MENTION_QUERY_PATTERN,
  openFanClubUpload,
  parseApplication,
  parseFanClubComment,
  parseFollowBody,
  parsePost,
  parseReaction,
  parseRulesAcceptance,
  readArtistFanClubs,
  readFanClubArtists,
  readFanClubComments,
  readFanClubFeed,
  readFanClubPage,
  readFanClubPost,
  readFanClubPosts,
  readFollowedFanClubs,
  readMentionSuggestions,
  readMyFanClub,
  readMyFanClubNumbers,
  readMyFanClubPosts,
  removeFanClubPost,
  reportFanClubComment,
  reportFanClubPost,
  requestFanClubCommentReview,
  setFanClubReaction,
  unfollowFanClub,
  unhideFanClubComment,
  withdrawApplication,
  type ApplicationInput,
  type CommentInput,
  type CommentsQuery,
  type FanClubReactionKey,
  type MentionsQuery,
  type PostInput,
} from '../../fan-clubs';
import {
  parseFanClubReportReason,
  parseReportReason,
  type FanClubReportReason,
  type ReportReason,
} from '../../moderation';
import { isContentId } from '../../page-cursor';
import { rewardsOf } from '../../points/award';
import type {
  ActionRewards,
  AddFanClubCommentResult,
  FanClubArtists,
  FanClubCard,
  FanClubCommentHiddenResult,
  FanClubCommentPage,
  FanClubCommentReviewResult,
  FanClubNumbers,
  FanClubPage,
  FanClubPost,
  FanClubPostDetails,
  FanClubReactionResult,
  FanClubUploadSlot,
  FollowedFanClubs,
  FollowFanClubResult,
  MentionSuggestions,
  MyFanClub,
  OwnFanClubPost,
  Page,
  ReportFanClubCommentResult,
  ReportFanClubPostResult,
  UnfollowFanClubResult,
} from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { pageQuery, queryText } from './paging';

// Rotas do fã-clube gerido pelo fã (seção 34, 34.3). A etapa 1 de 34.14: o
// estado do fã nos Ajustes, as centrais que aceitam fã-clube, candidatar e
// desistir. A etapa 2: o novo aceite do regulamento, a vaga de envio da foto,
// publicar, "Minhas publicações", retirar e tirar do ar, a página pública, as
// publicações no ar, a lista do artista e a denúncia. A etapa 3: os números
// do gestor (a soma dos shards da atribuição e os seguidores). A etapa 4:
// seguir e deixar de seguir, "Fã-clubes que sigo" e a seção "Dos seus
// fã-clubes" da Início. As que gravam rodam no runIdempotent, com o perfil
// exigido; as de desfazer (desistir, retirar e deixar de seguir) aceitam o
// suspenso. Os arquivos do Storage que saem ou trocam de token mudam depois da
// gravação (o `storageWork`, guardado na chave e refeito na repetição).
// Nenhuma rota devolve quem segue: o gestor vê só o número (decisão 29). A
// Fase 2 (seção 37, 37.3; a etapa 1 de 37.13): a publicação no ar pelo id, os
// comentários com as respostas de um nível, comentar e a reação; tirar a
// reação é de desfazer e aceita o suspenso. Nenhuma rota diz quem reagiu (R8).
// A etapa 2 de 37.13: as sugestões do @ (a conversa e a busca); as marcações
// do comentário e da publicação do gestor são resolvidas no envio, nas rotas
// que já existem. A etapa 3 (37.6): a denúncia de comentário de quem vê, o
// pedido de revisão do autor do oculto pelo gestor e o ocultar e o reexibir
// do gestor no próprio fã-clube, todas no runIdempotent, sem o
// `allowSuspended` (o suspenso não denuncia, não pede revisão e não oculta).

/**
 * O corpo da candidatura conferido e limpo (`parseApplication`), sem leitura:
 * o malformado é 400 `invalid_request` com o campo, e o fora da regra lança
 * `fan_club_invalid`.
 */
function bodyApplication(input: RouteInput): ApplicationInput {
  const parsed = parseApplication(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/** O corpo da publicação (`parsePost`), sem leitura, como o da candidatura. */
function bodyPost(input: RouteInput): PostInput {
  const parsed = parsePost(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/** O corpo do novo aceite (`parseRulesAcceptance`), sem leitura. */
function bodyRules(input: RouteInput): void {
  const parsed = parseRulesAcceptance(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
}

/**
 * A versão do aviso de membro no corpo do seguir (`parseFollowBody`), sem
 * leitura: sem corpo, null (o app de antes); o malformado e a outra versão
 * são 400 `invalid_request` com o campo.
 */
function bodyFollow(input: RouteInput): string | null {
  const parsed = parseFollowBody(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/** O `:clubId` no formato dos ids; fora dele, 404 `fan_club_not_found` sem ler nada. */
function clubParam(input: RouteInput): void {
  if (!isContentId(input.params.clubId)) throw apiError('fan_club_not_found');
}

/** O `:postId` no formato dos ids; fora dele, 404 `fan_club_post_not_found` sem ler nada. */
function postParam(input: RouteInput): void {
  if (!isContentId(input.params.postId)) throw apiError('fan_club_post_not_found');
}

/** O `:artistId` no formato do @ das centrais; fora dele, 404 `artist_not_found`, como no mural. */
function artistParam(input: RouteInput): void {
  if (!isArtistId(input.params.artistId)) throw apiError('artist_not_found');
}

/**
 * A busca dos comentários (seção 37, 37.3): o `limit` de 1 a 20 e o `cursor`
 * de sempre, e o `replyTo` (as respostas de um comentário de cima), no
 * formato dos ids; fora dele, 404 `fan_club_comment_not_found` sem ler nada.
 */
function commentsQuery(input: RouteInput): CommentsQuery {
  const page = pageQuery(input, FAN_CLUB_COMMENTS_PAGE);
  const replyTo = queryText(input.query, 'replyTo');
  if (replyTo === undefined || replyTo === '') return { ...page, replyTo: null };
  if (!isContentId(replyTo)) throw fanClubCommentNotFound();
  return { ...page, replyTo };
}

/**
 * O corpo do comentário (`parseFanClubComment`), sem leitura: o malformado é
 * 400 `invalid_request` com o campo, o `replyToId` fora do formato é 404
 * `fan_club_comment_not_found` e o texto fora da regra, `comment_invalid`.
 */
function bodyComment(input: RouteInput): CommentInput {
  const parsed = parseFanClubComment(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/**
 * A busca das sugestões do @ (seção 37, 37.3), sem leitura: o `postId`
 * opcional, no formato dos ids (fora dele, 404 `fan_club_post_not_found`), e
 * o `q` opcional, de 2 a 30 de `a-z`, `0-9` e `_`, sem o "@" e em minúsculas,
 * fora dos ids `__.*__`, que o Firestore reserva (o `q` vira o cursor de id da
 * busca; fora disso, 400 `invalid_request` com `field: 'q'`). Vazios valem
 * ausentes.
 */
function mentionsQuery(input: RouteInput): MentionsQuery {
  const postId = queryText(input.query, 'postId');
  if (postId !== undefined && postId !== '' && !isContentId(postId)) {
    throw apiError('fan_club_post_not_found');
  }
  const q = queryText(input.query, 'q');
  if (q !== undefined && q !== '' && !MENTION_QUERY_PATTERN.test(q)) {
    throw apiError('invalid_request', { field: 'q' });
  }
  return { postId: postId || null, q: q || null };
}

/** A reação do corpo (`parseReaction`), de uma lista fechada; fora dela, 400 sem ler. */
function bodyReaction(input: RouteInput): FanClubReactionKey {
  const parsed = parseReaction(input.body);
  if (!parsed.ok) throw apiError('invalid_request', { field: parsed.field });
  return parsed.value;
}

/** O motivo da denúncia (a lista do fã-clube, com o `image_misuse`, ou null); outro valor é 400. */
function reportReason(input: RouteInput): FanClubReportReason | null {
  const reason = parseFanClubReportReason(input.body);
  if (reason === undefined) throw apiError('invalid_request', { field: 'reason' });
  return reason;
}

/** O `:commentId` no formato dos ids; fora dele, 404 `fan_club_comment_not_found` sem ler nada. */
function commentParam(input: RouteInput): void {
  if (!isContentId(input.params.commentId)) throw apiError('fan_club_comment_not_found');
}

/**
 * O motivo da denúncia de comentário (seção 37, 37.3): os 4 do comentário do
 * Mural ou null (`parseReportReason`), sem o `image_misuse`, que é de imagem;
 * outro valor é 400.
 */
function commentReportReason(input: RouteInput): ReportReason | null {
  const reason = parseReportReason(input.body);
  if (reason === undefined) throw apiError('invalid_request', { field: 'reason' });
  return reason;
}

export const fanClubRoutes: ApiRoute[] = [
  {
    // Leve: os Ajustes leem a cada abertura (de 1 a 5 leituras). Sem chave e
    // sem exigir o perfil (a conta só da equipe recebe o estado vazio).
    method: 'GET',
    pattern: '/me/fan-club',
    writes: false,
    async handle({ deps, uid, now }): Promise<MyFanClub> {
      return readMyFanClub(deps.db, uid, now);
    },
  },
  {
    // Só no "Meu fã-clube" (etapa 3): a soma dos shards e os seguidores. Sem
    // o fã-clube da candidatura aprovada, 404 `fan_club_not_found`.
    method: 'GET',
    pattern: '/me/fan-club/numbers',
    writes: false,
    async handle({ deps, uid, now }): Promise<FanClubNumbers> {
      return readMyFanClubNumbers(deps.db, uid, now);
    },
  },
  {
    // Só ao abrir a candidatura, para não ler os artistPrivate a cada Ajustes aberto.
    method: 'GET',
    pattern: '/me/fan-club/artists',
    writes: false,
    async handle({ deps, uid }): Promise<FanClubArtists> {
      return readFanClubArtists(deps.db, uid);
    },
  },
  {
    method: 'POST',
    pattern: '/me/fan-club/application',
    writes: true,
    validate: (input) => void bodyApplication(input),
    async handle(ctx) {
      const { body, plan } = await applyForFanClub(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        input: bodyApplication(ctx),
      });
      const result: MyFanClub = body;
      return { body: result, plan };
    },
  },
  {
    // Desistir da pendente: desfazer, então o suspenso também desiste.
    method: 'DELETE',
    pattern: '/me/fan-club/application',
    writes: true,
    allowSuspended: true,
    async handle(ctx) {
      const { body, plan } = await withdrawApplication(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
      });
      const result: MyFanClub = body;
      return { body: result, plan };
    },
  },
  {
    // O novo aceite quando o regulamento muda (o `rulesOutdated`): a versão do
    // corpo igual à do servidor. Já aceita, a mesma resposta sem gravar.
    method: 'PUT',
    pattern: '/me/fan-club/rules',
    writes: true,
    validate: bodyRules,
    async handle(ctx) {
      bodyRules(ctx);
      const { body, plan } = await acceptFanClubRules(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
      });
      const result: MyFanClub = body;
      return { body: result, plan };
    },
  },
  {
    // "Minhas publicações": em todos os status, da mais nova. Sem chave e sem
    // exigir o perfil (quem nunca publicou recebe a página vazia).
    method: 'GET',
    pattern: '/me/fan-club/posts',
    writes: false,
    validate: (input) => void pageQuery(input, FAN_CLUB_POSTS_PAGE),
    async handle(ctx): Promise<Page<OwnFanClubPost>> {
      return readMyFanClubPosts(ctx.deps.db, ctx.uid, pageQuery(ctx, FAN_CLUB_POSTS_PAGE));
    },
  },
  {
    // A vaga de envio da foto (10 min), com o teto `fanclub_upload`. Os
    // arquivos da vaga de antes, que não viraram publicação, saem depois.
    method: 'POST',
    pattern: '/me/fan-club/upload',
    writes: true,
    async handle(ctx) {
      const { body, plan, stale } = await openFanClubUpload(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
      });
      const result: FanClubUploadSlot = body;
      return { body: result, plan, storageWork: { remove: stale, rotate: [] } };
    },
  },
  {
    // Publicar: sempre em análise (decisão 16), com o teto `fanclub_post`, no
    // máximo 3 em análise e, com foto, a vaga e os bytes dos dois arquivos.
    method: 'POST',
    pattern: '/me/fan-club/posts',
    writes: true,
    validate: (input) => void bodyPost(input),
    async handle(ctx) {
      const { body, plan } = await createFanClubPost(ctx.tx, ctx.deps.db, ctx.deps.files, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        input: bodyPost(ctx),
      });
      const result: OwnFanClubPost = body;
      return { body: result, plan };
    },
  },
  {
    // Retirar a em análise e tirar do ar a publicada: desfazer, então o
    // suspenso também. Os arquivos saem (retirada) ou trocam de token (tirada
    // do ar) depois da gravação.
    method: 'DELETE',
    pattern: '/me/fan-club/posts/:postId',
    writes: true,
    allowSuspended: true,
    validate: postParam,
    async handle(ctx) {
      const { body, plan, work } = await removeFanClubPost(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
      });
      const result: OwnFanClubPost = body;
      return { body: result, plan, storageWork: work };
    },
  },
  {
    // Os fã-clubes do artista: os destacados primeiro, depois pelos seguidores
    // da cópia, sem os de gestor bloqueado. O artista fora do ar ou sem o
    // fã-clube aberto: a página vazia.
    method: 'GET',
    pattern: '/artists/:artistId/fan-clubs',
    writes: false,
    validate: (input) => {
      artistParam(input);
      pageQuery(input, ARTIST_FAN_CLUBS_PAGE);
    },
    async handle(ctx): Promise<Page<FanClubCard>> {
      return readArtistFanClubs(
        ctx.deps.db,
        ctx.uid,
        ctx.params.artistId!,
        pageQuery(ctx, ARTIST_FAN_CLUBS_PAGE),
        ctx.now,
      );
    },
  },
  {
    // A página pública: 404 para o pausado, o encerrado, o de artista fora do
    // ar ou sem o fã-clube aberto e o de gestor que quem pede bloqueou.
    method: 'GET',
    pattern: '/fan-clubs/:clubId',
    writes: false,
    validate: clubParam,
    async handle(ctx): Promise<FanClubPage> {
      return readFanClubPage(ctx.deps.db, ctx.uid, ctx.params.clubId!, ctx.now);
    },
  },
  {
    method: 'GET',
    pattern: '/fan-clubs/:clubId/posts',
    writes: false,
    validate: (input) => {
      clubParam(input);
      pageQuery(input, FAN_CLUB_POSTS_PAGE);
    },
    async handle(ctx): Promise<Page<FanClubPost>> {
      return readFanClubPosts(
        ctx.deps.db,
        ctx.uid,
        ctx.params.clubId!,
        pageQuery(ctx, FAN_CLUB_POSTS_PAGE),
      );
    },
  },
  {
    // Denunciar uma publicação no ar, com o teto `report` de sempre. A própria
    // é 400 `own_post`; o suspenso recebe 403 (sem `allowSuspended`).
    method: 'POST',
    pattern: '/fan-club-posts/:postId/report',
    writes: true,
    validate: (input) => {
      postParam(input);
      reportReason(input);
    },
    async handle(ctx) {
      const postId = ctx.params.postId!;
      const { plan, status } = await reportFanClubPost(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId,
        reason: reportReason(ctx),
      });
      const body: ReportFanClubPostResult = { postId, status };
      return { body, plan };
    },
  },
  {
    // Seguir: quando falta, entra junto na central oficial (o central_join de
    // sempre, com a comemoração). Já seguindo, a mesma resposta sem gravar. A
    // versão do aviso de membro no corpo vira a marca do vínculo novo (seção
    // 37, "Estado"); sem corpo, o app de antes, o vínculo fica sem a marca.
    method: 'PUT',
    pattern: '/me/fan-club-follows/:clubId',
    writes: true,
    validate: (input) => {
      clubParam(input);
      bodyFollow(input);
    },
    async handle(ctx) {
      const { body, plan } = await followFanClub(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        clubId: ctx.params.clubId!,
        memberNoticeVersion: bodyFollow(ctx),
      });
      const result: FollowFanClubResult & ActionRewards = { ...body, ...rewardsOf(plan) };
      return { body: result, plan };
    },
  },
  {
    // Deixar de seguir, em qualquer status do fã-clube: desfazer, então o
    // suspenso também. Nunca recusa; não mexe na central.
    method: 'DELETE',
    pattern: '/me/fan-club-follows/:clubId',
    writes: true,
    allowSuspended: true,
    validate: clubParam,
    async handle(ctx) {
      const { body, plan } = await unfollowFanClub(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        clubId: ctx.params.clubId!,
      });
      const result: UnfollowFanClubResult = body;
      return { body: result, plan };
    },
  },
  {
    // "Fã-clubes que sigo": até 50, com o indisponível marcado. Sem chave e
    // sem exigir o perfil (quem nunca seguiu recebe a lista vazia).
    method: 'GET',
    pattern: '/me/fan-club-follows',
    writes: false,
    async handle({ deps, uid }): Promise<FollowedFanClubs> {
      return readFollowedFanClubs(deps.db, uid);
    },
  },
  {
    // "Dos seus fã-clubes" da Início: as publicações no ar dos 20 vínculos
    // mais novos, 10 por página. Sem vínculo, a página vazia.
    method: 'GET',
    pattern: '/me/fan-club-feed',
    writes: false,
    validate: (input) => void pageQuery(input, FAN_CLUB_POSTS_PAGE),
    async handle(ctx): Promise<Page<FanClubPost>> {
      return readFanClubFeed(ctx.deps.db, ctx.uid, pageQuery(ctx, FAN_CLUB_POSTS_PAGE));
    },
  },
  {
    // A publicação no ar (seção 37, 37.3): a tela da publicação. Fora do ar,
    // de fã-clube que quem pede não vê ou que não existe: 404.
    method: 'GET',
    pattern: '/fan-club-posts/:postId',
    writes: false,
    validate: postParam,
    async handle(ctx): Promise<FanClubPostDetails> {
      return readFanClubPost(ctx.deps.db, ctx.uid, ctx.params.postId!);
    },
  },
  {
    // Os comentários de cima, do mais novo, ou as respostas de um deles
    // (`?replyTo=`), da mais antiga. Não exige seguir: ler é de quem vê.
    method: 'GET',
    pattern: '/fan-club-posts/:postId/comments',
    writes: false,
    validate: (input) => {
      postParam(input);
      commentsQuery(input);
    },
    async handle(ctx): Promise<FanClubCommentPage> {
      return readFanClubComments(ctx.deps.db, ctx.uid, ctx.params.postId!, commentsQuery(ctx));
    },
  },
  {
    // Comentar ou responder: quem segue e o gestor, com o teto `club_comment`.
    // A resposta a uma resposta vai para o comentário de cima dela (R7).
    method: 'POST',
    pattern: '/fan-club-posts/:postId/comments',
    writes: true,
    validate: (input) => {
      postParam(input);
      bodyComment(input);
    },
    async handle(ctx) {
      const { plan, comment } = await addFanClubComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        profile: ctx.profile,
        postId: ctx.params.postId!,
        input: bodyComment(ctx),
      });
      // Sem id fixo (só o seed passa), o comentário sempre nasce.
      const body: AddFanClubCommentResult = { ...comment!, ...rewardsOf(plan) };
      return { body, plan };
    },
  },
  {
    // Reagir ou trocar de emoji: quem segue e o gestor, com o teto
    // `club_react`. A mesma reação responde os números sem gravar.
    method: 'PUT',
    pattern: '/fan-club-posts/:postId/reaction',
    writes: true,
    validate: (input) => {
      postParam(input);
      bodyReaction(input);
    },
    async handle(ctx) {
      const { plan, body } = await setFanClubReaction(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
        reaction: bodyReaction(ctx),
      });
      const result: FanClubReactionResult = { ...body, ...rewardsOf(plan) };
      return { body: result, plan };
    },
  },
  {
    // Tirar a reação, em qualquer status da publicação: desfazer, então o
    // suspenso também. Nunca recusa; não tira ponto nem desconta o dia.
    method: 'DELETE',
    pattern: '/fan-club-posts/:postId/reaction',
    writes: true,
    allowSuspended: true,
    validate: postParam,
    async handle(ctx) {
      const { plan, body } = await clearFanClubReaction(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        postId: ctx.params.postId!,
      });
      const result: FanClubReactionResult = { ...body, ...rewardsOf(plan) };
      return { body: result, plan };
    },
  },
  {
    // As sugestões do @ (a etapa 2 de 37.13): sem o `q`, a conversa (o
    // gestor, o artista e quem comentou na publicação do `postId`); com o
    // `q`, a busca pelo começo do @. Só para quem pode comentar ali (seguir
    // ou ser o gestor). Nunca diz quem segue (R5) nem busca pelo nome (R6).
    method: 'GET',
    pattern: '/fan-clubs/:clubId/mentions',
    writes: false,
    validate: (input) => {
      clubParam(input);
      mentionsQuery(input);
    },
    async handle(ctx): Promise<MentionSuggestions> {
      return readMentionSuggestions(ctx.deps.db, ctx.uid, ctx.params.clubId!, mentionsQuery(ctx));
    },
  },
  {
    // Denunciar um comentário à vista de quem pede (a etapa 3 de 37.13), sem
    // exigir seguir, com o teto `report` de sempre. O próprio é 400
    // `own_comment`; na mesma rodada do item, `already_reported`.
    method: 'POST',
    pattern: '/fan-club-comments/:commentId/report',
    writes: true,
    validate: (input) => {
      commentParam(input);
      commentReportReason(input);
    },
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, status } = await reportFanClubComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        commentId,
        reason: commentReportReason(ctx),
      });
      const body: ReportFanClubCommentResult = { commentId, status };
      return { body, plan };
    },
  },
  {
    // O "Pedir revisão" do autor do comentário oculto pelo gestor, uma vez por
    // ocultar, no teto `report`. O comentário alheio ou em outro status é 404.
    method: 'POST',
    pattern: '/fan-club-comments/:commentId/review',
    writes: true,
    validate: commentParam,
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, status } = await requestFanClubCommentReview(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        commentId,
      });
      const body: FanClubCommentReviewResult = { commentId, status };
      return { body, plan };
    },
  },
  {
    // O gestor oculta um comentário do próprio fã-clube (rota de estado:
    // repetir não muda nada). Sem teto; o reexibido pela equipe é 409
    // `staff_decided`, e o dele, 400 `own_comment`.
    method: 'PUT',
    pattern: '/me/fan-club/hidden-comments/:commentId',
    writes: true,
    validate: commentParam,
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, hidden } = await hideFanClubComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        commentId,
      });
      const body: FanClubCommentHiddenResult = { commentId, hidden };
      return { body, plan };
    },
  },
  {
    // O gestor reexibe só o que ele ocultou; o resto é 404.
    method: 'DELETE',
    pattern: '/me/fan-club/hidden-comments/:commentId',
    writes: true,
    validate: commentParam,
    async handle(ctx) {
      const commentId = ctx.params.commentId!;
      const { plan, hidden } = await unhideFanClubComment(ctx.tx, ctx.deps.db, {
        fan: ctx.fan,
        award: ctx.award,
        commentId,
      });
      const body: FanClubCommentHiddenResult = { commentId, hidden };
      return { body, plan };
    },
  },
];
