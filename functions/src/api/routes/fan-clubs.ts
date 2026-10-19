import { isArtistId } from '../../centrals/model';
import {
  acceptFanClubRules,
  applyForFanClub,
  ARTIST_FAN_CLUBS_PAGE,
  createFanClubPost,
  FAN_CLUB_POSTS_PAGE,
  openFanClubUpload,
  parseApplication,
  parsePost,
  parseRulesAcceptance,
  readArtistFanClubs,
  readFanClubArtists,
  readFanClubPage,
  readFanClubPosts,
  readMyFanClub,
  readMyFanClubPosts,
  removeFanClubPost,
  reportFanClubPost,
  withdrawApplication,
  type ApplicationInput,
  type PostInput,
} from '../../fan-clubs';
import { parseFanClubReportReason, type FanClubReportReason } from '../../moderation';
import { isContentId } from '../../page-cursor';
import type {
  FanClubArtists,
  FanClubCard,
  FanClubPage,
  FanClubPost,
  FanClubUploadSlot,
  MyFanClub,
  OwnFanClubPost,
  Page,
  ReportFanClubPostResult,
} from '../contract';
import { apiError } from '../errors';
import type { ApiRoute, RouteInput } from '../types';
import { pageQuery } from './paging';

// Rotas do fã-clube gerido pelo fã (seção 34, 34.3). A etapa 1 de 34.14: o
// estado do fã nos Ajustes, as centrais que aceitam fã-clube, candidatar e
// desistir. A etapa 2: o novo aceite do regulamento, a vaga de envio da foto,
// publicar, "Minhas publicações", retirar e tirar do ar, a página pública, as
// publicações no ar, a lista do artista e a denúncia. As que gravam rodam no
// runIdempotent, com o perfil exigido; as de desfazer (desistir e retirar)
// aceitam o suspenso. Os arquivos do Storage que saem ou trocam de token
// mudam depois da gravação (o `storageWork`, guardado na chave e refeito na
// repetição). Os seguidores chegam na etapa 4.

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

/** O motivo da denúncia (a lista do fã-clube, com o `image_misuse`, ou null); outro valor é 400. */
function reportReason(input: RouteInput): FanClubReportReason | null {
  const reason = parseFanClubReportReason(input.body);
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
];
