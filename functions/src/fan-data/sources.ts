// As fontes de dados de um fã (seção 32, decisão 8 e 32.3 de
// docs/arquitetura-api.md): a lista que a exportação (`exportFanData`)
// percorre e que o teste de emulador prende à exclusão de conta
// (`deleteUserData`, em store.ts). Cada fonte diz onde fica no arquivo (a
// primeira chamada, uma parte longa, só o endereço ou fora, com o motivo),
// como é lida pelo uid, os campos que saem do arquivo (`omit`) e o que a
// exclusão faz com ela. Puro: nada aqui lê o Firestore.
//
// Fonte nova do fã entra aqui e no `deleteUserData`. Campo novo de uma fonte
// vai ao arquivo como está gravado; campo novo com uid, nome ou chave de outra
// pessoa ou da equipe entra no `omit` (32.17).

/** As partes longas, em páginas, na ordem do arquivo (32.3). */
export const FAN_DATA_PARTS = [
  'extrato',
  'pontosPorCentral',
  'centrais',
  'curtidas',
  'presencas',
  'comentarios',
  'linksDeConvite',
  'pedidosDaLoja',
  'publicacoesDeFaClube',
] as const;

export type FanDataPart = (typeof FAN_DATA_PARTS)[number];

/** As chaves da primeira chamada, na ordem do arquivo (32.3), antes do `partes`. */
export const FAN_DATA_FIRST_KEYS = [
  'conta',
  'perfil',
  'contato',
  'arrobasReservados',
  'carteira',
  'convite',
  'codigosDeConvite',
  'origem',
  'pessoasTrazidas',
  'bloqueios',
  'denunciasDeComentario',
  'denunciasDePerfil',
  'temporadas',
  'candidaturaDeFaClube',
  'candidaturaDeFaClubePrivada',
  'faClubes',
  'denunciasDeFaClube',
] as const;

export type FanDataFirstKey = (typeof FAN_DATA_FIRST_KEYS)[number];

/** Os documentos do fã com subcoleções, pelo uid (o teste do `listCollections()`). */
export const FAN_DATA_PARENTS = ['users', 'wallets', 'fanInvites'] as const;

export type FanDataParent = (typeof FAN_DATA_PARENTS)[number];

/** Onde a fonte fica no arquivo. */
export type FanDataPlace =
  /** Na primeira chamada, com esta chave. */
  | { in: 'first'; key: FanDataFirstKey }
  /** Numa parte longa, em páginas de até 500 pela ordem do id. */
  | { in: 'part'; part: FanDataPart }
  /**
   * Só o endereço, num campo de outra fonte: a foto, no `photoURL` do perfil;
   * as fotos das publicações do fã-clube, na `media` delas (uma parte longa).
   */
  | { in: 'address'; key: FanDataFirstKey | FanDataPart; field: string }
  /** Fora do arquivo, com o motivo. */
  | { in: 'out'; reason: string };

/** Como a fonte é achada pelo uid do fã (o leitor). */
export type FanDataRead =
  /** A conta do Authentication (`auth.getUser`). */
  | { kind: 'auth' }
  /** O documento `<collection>/{uid}`. */
  | { kind: 'doc'; collection: string }
  /** O documento `<parent>/{uid}/<name>/<id>`, único na subcoleção (o contato do fã, seção 35). */
  | { kind: 'subdoc'; parent: FanDataParent; name: string; id: string }
  /** A subcoleção `<parent>/{uid}/<name>`, pela ordem do id. */
  | { kind: 'sub'; parent: FanDataParent; name: string }
  /** `<collection>` com `<field> == uid`, pela ordem do id (o índice automático do campo). */
  | { kind: 'equal'; collection: string; field: string }
  /**
   * O grupo `<group>` (debaixo de `<parent>/{id}`) com `<field> == uid`, pela
   * ordem do caminho (a isenção do campo com o escopo do grupo).
   */
  | { kind: 'group'; group: string; parent: string; field: string }
  /** A contagem de `<collection>` com `<field> == uid`. */
  | { kind: 'count'; collection: string; field: string }
  /** `seasons/{id}/standings/{uid}`: os ids das temporadas e um `getAll`. */
  | { kind: 'standings' }
  /** Não se acha pelo uid do fã num lugar só (a carteira de outra pessoa, o Storage, os logs). */
  | { kind: 'none'; where: string };

/** O que a exclusão de conta faz com a fonte (o gatilho `deleteUserProfile`, seção 12). */
export type FanDataDeletionEffect =
  /** A exclusão começa por ela: o `deleteUser` dispara o gatilho. */
  | 'account'
  /** Apagada. */
  | 'deleted'
  /** Fica, sem o uid e as cópias do fã (os pedidos da loja). */
  | 'stripped'
  /** Fica, desligada do fã (o `inviterUid` dos convidados vira null). */
  | 'detached'
  /** Fica como está. */
  | 'kept';

export type FanDataSource = {
  /** O nome da fonte, único. */
  id: string;
  /** O lugar, como na tabela de 32.3. */
  label: string;
  place: FanDataPlace;
  read: FanDataRead;
  /**
   * Os campos que saem do arquivo, por caminho com ponto (`*` vale qualquer
   * chave de um mapa): o técnico e o dado de outra pessoa ou da equipe.
   */
  omit: readonly string[];
  /**
   * No extrato: o `actor` só com o `type`, e nos `invite_visit` e
   * `invite_signup` o id só com a origem, sem o `eventId` (a chave da pessoa
   * trazida). O `after` das páginas segue com o id de verdade (32.3).
   */
  mask?: 'ledger';
  /** A lista leva só os ids (as reservas de @). */
  idsOnly?: true;
  /** A lista leva também o id do documento pai, com este nome (o `postId` do comentário). */
  parentField?: string;
  /** O id de cada item é o do documento pai (a temporada, em `seasons/{id}/standings/{uid}`). */
  idFromParent?: true;
  deletion: { effect: FanDataDeletionEffect; note: string };
};

/** Os campos técnicos do perfil, fora do arquivo (decisão 8): a busca, a marca do cadastro e o caminho da foto. */
export const PROFILE_TECHNICAL_FIELDS = ['searchKeys', 'signupCounted', 'photoPath'] as const;

/**
 * As fontes, na ordem da tabela de 32.3 (a ordem do arquivo é a de
 * `FAN_DATA_FIRST_KEYS` e de `FAN_DATA_PARTS`).
 */
export const FAN_DATA_SOURCES: readonly FanDataSource[] = [
  {
    id: 'auth',
    label: 'Auth (getUser)',
    place: { in: 'first', key: 'conta' },
    read: { kind: 'auth' },
    omit: [],
    deletion: { effect: 'account', note: 'começa por ela' },
  },
  {
    id: 'users',
    label: 'users/{uid}',
    place: { in: 'first', key: 'perfil' },
    read: { kind: 'doc', collection: 'users' },
    omit: PROFILE_TECHNICAL_FIELDS,
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    // O `fanClubId` (seção 34, 34.7) diria quem convidou, que o arquivo já
    // tira do `referrals`; o `firstJoin` vai.
    id: 'users.centrals',
    label: 'users/{uid}/centrals',
    place: { in: 'part', part: 'centrais' },
    read: { kind: 'sub', parent: 'users', name: 'centrals' },
    omit: ['fanClubId'],
    deletion: { effect: 'deleted', note: 'apagado, com o fanCount' },
  },
  {
    id: 'users.postLikes',
    label: 'users/{uid}/postLikes',
    place: { in: 'part', part: 'curtidas' },
    read: { kind: 'sub', parent: 'users', name: 'postLikes' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado, com a contagem do post' },
  },
  {
    id: 'users.eventRsvps',
    label: 'users/{uid}/eventRsvps',
    place: { in: 'part', part: 'presencas' },
    read: { kind: 'sub', parent: 'users', name: 'eventRsvps' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'users.profileSync',
    label: 'users/{uid}/profileSync',
    place: { in: 'out', reason: 'técnico: o orçamento das cópias do nome e da foto' },
    read: { kind: 'sub', parent: 'users', name: 'profileSync' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'users.uploads',
    label: 'users/{uid}/uploads',
    place: { in: 'out', reason: 'técnico: a vaga do envio da foto' },
    read: { kind: 'sub', parent: 'users', name: 'uploads' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    // O marcador do crédito de entrada do fã-clube (seção 34, decisão 23).
    id: 'users.fanClubCredits',
    label: 'users/{uid}/fanClubCredits',
    place: {
      in: 'out',
      reason:
        "técnico: o marcador da antifraude do fã-clube, e o via 'owner_code' diria quem convidou",
    },
    read: { kind: 'sub', parent: 'users', name: 'fanClubCredits' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado (o recursiveDelete do perfil)' },
  },
  {
    // O WhatsApp do fã (seção 35): sai inteiro, com a origem e a data.
    id: 'users.contact',
    label: 'users/{uid}/contact/main',
    place: { in: 'first', key: 'contato' },
    read: { kind: 'subdoc', parent: 'users', name: 'contact', id: 'main' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado (o recursiveDelete do perfil)' },
  },
  {
    id: 'usernames',
    label: 'usernames com uid ==',
    place: { in: 'first', key: 'arrobasReservados' },
    read: { kind: 'equal', collection: 'usernames', field: 'uid' },
    omit: [],
    idsOnly: true,
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'wallets',
    label: 'wallets/{uid}',
    place: { in: 'first', key: 'carteira' },
    read: { kind: 'doc', collection: 'wallets' },
    // Os resumos dos alvos já contados nas missões: nas de convite, o resumo
    // da chave da pessoa trazida.
    omit: ['missions.*.items.*.keys'],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'wallets.ledger',
    label: 'wallets/{uid}/ledger',
    place: { in: 'part', part: 'extrato' },
    read: { kind: 'sub', parent: 'wallets', name: 'ledger' },
    // O `note` é o motivo do ajuste, texto livre da equipe: o painel diz a quem
    // ajusta que o fã não vê o motivo, e ele pode citar outra pessoa.
    omit: ['uid', 'note'],
    mask: 'ledger',
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'wallets.centralPoints',
    label: 'wallets/{uid}/centralPoints',
    place: { in: 'part', part: 'pontosPorCentral' },
    read: { kind: 'sub', parent: 'wallets', name: 'centralPoints' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'fanInvites',
    label: 'fanInvites/{uid}',
    place: { in: 'first', key: 'convite' },
    read: { kind: 'doc', collection: 'fanInvites' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'fanInvites.inviteLinks',
    label: 'fanInvites/{uid}/inviteLinks',
    place: { in: 'part', part: 'linksDeConvite' },
    read: { kind: 'sub', parent: 'fanInvites', name: 'inviteLinks' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'fanInvites.inviteVisitors',
    label: 'fanInvites/{uid}/inviteVisitors',
    place: { in: 'out', reason: 'chaves HMAC do e-mail de outras pessoas' },
    read: { kind: 'sub', parent: 'fanInvites', name: 'inviteVisitors' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'inviteCodes',
    label: 'inviteCodes com uid ==',
    place: { in: 'first', key: 'codigosDeConvite' },
    read: { kind: 'equal', collection: 'inviteCodes', field: 'uid' },
    // A chave do e-mail do dono, que não sai do servidor (firestore.rules).
    omit: ['ownerKey'],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'referrals',
    label: 'referrals/{uid}',
    place: { in: 'first', key: 'origem' },
    read: { kind: 'doc', collection: 'referrals' },
    // De quem convidou o fã, que é outra pessoa: o uid; o `award`, o status do
    // pagamento a ela (`skipped` com ela suspensa, `capped` no limite do dia
    // dela); e o `inviterRemovedAt`, quando ela excluiu a conta.
    omit: ['inviterUid', 'award', 'inviterRemovedAt'],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'referrals.inviter',
    label: 'referrals com inviterUid ==',
    place: { in: 'first', key: 'pessoasTrazidas' },
    read: { kind: 'count', collection: 'referrals', field: 'inviterUid' },
    omit: [],
    deletion: { effect: 'detached', note: 'desligado (inviterUid null)' },
  },
  {
    id: 'inviterLedger',
    label: 'wallets/<quem convidou>/ledger',
    place: {
      in: 'out',
      reason:
        'os invite_* e as missões que o fã pagou a quem o convidou são da carteira de outra pessoa',
    },
    read: { kind: 'none', where: 'a carteira de quem convidou o fã' },
    omit: [],
    deletion: {
      effect: 'kept',
      note: 'ficam, com o uid do fã no actor e a chave dele no id (pergunta 16; jurídico, UP-45)',
    },
  },
  {
    id: 'postComments',
    label: 'grupo postComments com authorUid ==',
    place: { in: 'part', part: 'comentarios' },
    read: { kind: 'group', group: 'postComments', parent: 'posts', field: 'authorUid' },
    // O uid de quem é da equipe e ocultou o comentário.
    omit: ['hiddenBy'],
    parentField: 'postId',
    deletion: { effect: 'deleted', note: 'apagado, com a contagem e a fila' },
  },
  {
    id: 'commentReports',
    label: 'commentReports com reporterUid ==',
    place: { in: 'first', key: 'denunciasDeComentario' },
    read: { kind: 'equal', collection: 'commentReports', field: 'reporterUid' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado, descontado da fila' },
  },
  {
    id: 'profileReports',
    label: 'profileReports com reporterUid ==',
    place: { in: 'first', key: 'denunciasDePerfil' },
    read: { kind: 'equal', collection: 'profileReports', field: 'reporterUid' },
    // A rodada do item de outro fã na profileReportQueue.
    omit: ['round'],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'blockLists',
    label: 'blockLists/{uid}',
    place: { in: 'first', key: 'bloqueios' },
    read: { kind: 'doc', collection: 'blockLists' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado, e o uid sai das listas dos outros' },
  },
  {
    id: 'redemptions',
    label: 'redemptions com uid ==',
    place: { in: 'part', part: 'pedidosDaLoja' },
    read: { kind: 'equal', collection: 'redemptions', field: 'uid' },
    // O uid e o nome de quem é da equipe e mudou o pedido.
    omit: ['updatedBy'],
    deletion: {
      effect: 'stripped',
      note: 'o aberto cancelado, e todos sem o uid e as cópias',
    },
  },
  {
    id: 'standings',
    label: 'seasons/*/standings/{uid}',
    place: { in: 'first', key: 'temporadas' },
    read: { kind: 'standings' },
    omit: [],
    idFromParent: true,
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    // O fã-clube gerido pelo fã (seção 34, 34.7), desde a etapa 1 de 34.14.
    id: 'fanClubApplications',
    label: 'fanClubApplications/{uid}',
    place: { in: 'first', key: 'candidaturaDeFaClube' },
    read: { kind: 'doc', collection: 'fanClubApplications' },
    // O uid e o nome de quem é da equipe e decidiu.
    omit: ['decidedBy'],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'fanClubApplicationPrivate',
    label: 'fanClubApplicationPrivate/{uid}',
    place: { in: 'first', key: 'candidaturaDeFaClubePrivada' },
    read: { kind: 'doc', collection: 'fanClubApplicationPrivate' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'fanClubs',
    label: 'fanClubs com ownerUid ==',
    place: { in: 'first', key: 'faClubes' },
    read: { kind: 'equal', collection: 'fanClubs', field: 'ownerUid' },
    // O uid e o nome de quem é da equipe e aprovou, encerrou ou destacou.
    omit: ['approvedBy', 'closedBy', 'featuredBy'],
    deletion: {
      effect: 'stripped',
      note: 'vira lápide: encerrado, sem o dono, as cópias e o nome (decisão 21)',
    },
  },
  {
    // As publicações do fã-clube (seção 34, 34.7), desde a etapa 2 de 34.14.
    id: 'fanClubPosts',
    label: 'fanClubPosts com authorUid ==',
    place: { in: 'part', part: 'publicacoesDeFaClube' },
    read: { kind: 'equal', collection: 'fanClubPosts', field: 'authorUid' },
    // O uid e o nome de quem é da equipe e decidiu a publicação.
    omit: ['reviewedBy'],
    deletion: { effect: 'deleted', note: 'apagada, com o item aberto da fila em author_deleted' },
  },
  {
    id: 'fanClubReports',
    label: 'fanClubReports com reporterUid ==',
    place: { in: 'first', key: 'denunciasDeFaClube' },
    read: { kind: 'equal', collection: 'fanClubReports', field: 'reporterUid' },
    // A rodada do item da fila de outro fã.
    omit: ['round'],
    deletion: { effect: 'deleted', note: 'apagada, descontada da rodada aberta' },
  },
  {
    id: 'moderationQueue',
    label: 'moderationQueue (os comentários do fã)',
    place: {
      in: 'out',
      reason: 'denúncias contra o fã, de quem denunciou (jurídico, UP-45)',
    },
    read: { kind: 'equal', collection: 'moderationQueue', field: 'authorUid' },
    omit: [],
    deletion: { effect: 'kept', note: 'fica o item do comentário, sem o texto' },
  },
  {
    id: 'profileReportQueue',
    label: 'profileReportQueue/{uid}',
    place: {
      in: 'out',
      reason: 'denúncias contra o fã, de quem denunciou (jurídico, UP-45)',
    },
    read: { kind: 'doc', collection: 'profileReportQueue' },
    omit: [],
    deletion: { effect: 'kept', note: 'fica o item do perfil, sem o resolvedDigest' },
  },
  {
    id: 'fanClubReportQueue',
    label: 'fanClubReportQueue (as publicações do fã)',
    place: {
      in: 'out',
      reason: 'denúncias contra o fã, de quem denunciou (jurídico, UP-45)',
    },
    read: { kind: 'equal', collection: 'fanClubReportQueue', field: 'authorUid' },
    omit: [],
    deletion: { effect: 'kept', note: 'fica o item da publicação, em author_deleted' },
  },
  {
    id: 'idempotency',
    label: 'idempotency com uid ==',
    place: { in: 'out', reason: 'cópias técnicas das respostas, 30 dias' },
    read: { kind: 'equal', collection: 'idempotency', field: 'uid' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'staff',
    label: 'staff/{uid}',
    place: { in: 'out', reason: 'o acesso ao painel não é dado de fã' },
    read: { kind: 'doc', collection: 'staff' },
    omit: [],
    deletion: {
      effect: 'deleted',
      note: 'apagado (a exclusão pela equipe recusa antes, fan-is-staff)',
    },
  },
  {
    id: 'storage.fans',
    label: 'Storage fans/{uid}/',
    place: { in: 'address', key: 'perfil', field: 'photoURL' },
    read: { kind: 'none', where: 'a pasta fans/{uid}/ do Storage' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagado' },
  },
  {
    id: 'storage.fanClubMedia',
    label: 'Storage fanClubMedia/{uid}/',
    place: { in: 'address', key: 'publicacoesDeFaClube', field: 'media' },
    read: { kind: 'none', where: 'a pasta fanClubMedia/{uid}/ do Storage' },
    omit: [],
    deletion: { effect: 'deleted', note: 'apagada' },
  },
  {
    id: 'staffAudit',
    label: 'staffAudit com o uid',
    place: { in: 'out', reason: 'registro interno, com o nome de quem é da equipe' },
    read: { kind: 'none', where: 'os alvos fan:<uid> das entradas da auditoria' },
    omit: [],
    deletion: { effect: 'kept', note: 'fica (seção 8 da política)' },
  },
  {
    id: 'accessLog',
    label: 'registro de acesso (31.7)',
    place: { in: 'out', reason: 'aviso no arquivo (decisão 9): pedido à equipe' },
    read: { kind: 'none', where: 'o bucket registros-de-acesso do Cloud Logging' },
    omit: [],
    deletion: { effect: 'kept', note: 'fica 184 dias' },
  },
];

/** A fonte de um nome (lança com o nome desconhecido: erro de código). */
export function fanDataSource(id: string): FanDataSource {
  const source = FAN_DATA_SOURCES.find((item) => item.id === id);
  if (!source) throw new Error(`Fonte de dados do fã desconhecida: ${id}`);
  return source;
}

/** A fonte de cada parte longa. */
export function partSource(part: FanDataPart): FanDataSource {
  const source = FAN_DATA_SOURCES.find(
    (item) => item.place.in === 'part' && item.place.part === part,
  );
  if (!source) throw new Error(`Parte sem fonte: ${part}`);
  return source;
}

/** A fonte de cada chave da primeira chamada. */
export function firstKeySource(key: FanDataFirstKey): FanDataSource {
  const source = FAN_DATA_SOURCES.find(
    (item) => item.place.in === 'first' && item.place.key === key,
  );
  if (!source) throw new Error(`Chave sem fonte: ${key}`);
  return source;
}

/**
 * As subcoleções conhecidas de um documento do fã (as do arquivo e as de
 * fora): o teste de emulador confere o `listCollections()` contra elas, e
 * uma subcoleção nova pede a fonte aqui e o passo no `deleteUserData`.
 */
export function knownSubcollections(parent: FanDataParent): string[] {
  return FAN_DATA_SOURCES.flatMap((item) =>
    (item.read.kind === 'sub' || item.read.kind === 'subdoc') && item.read.parent === parent
      ? [item.read.name]
      : [],
  );
}
