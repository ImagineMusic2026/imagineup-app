/**
 * Perfil básico do fã, lido de `users/{uid}` no Firestore. Nasce no servidor
 * (função `createUserProfile`) alguns segundos depois do cadastro; o celular só
 * lê o próprio e muda `displayName` e `city` direto (a tela "Editar perfil",
 * bloco 9). O @ e a foto mudam pela API.
 */
export interface FanProfile {
  uid: string;
  /** `null` quando o nome do cadastro não passou em `visibleLine()`: o fã preenche depois. */
  displayName: string | null;
  /** O @ sem a arroba ("camilarib"). */
  username: string | null;
  city: string | null;
  /** Gravada pelo servidor depois de validar o upload; a do provedor não é copiada. */
  photoURL: string | null;
  /** ISO. O `Timestamp` do Firestore vira texto antes do cache, que vai para o disco em JSON. */
  createdAt: string | null;
  /**
   * ISO: a partir de quando o fã troca o @ de novo (a troca mais 30 dias, do
   * servidor); `null` sem prazo. Opcional: o perfil salvo no disco antes do
   * bloco 9 não tem o campo.
   */
  usernameChangeableAt?: string | null;
  /**
   * ISO: desde quando a conta está suspensa pela equipe (bloco 11); ausente
   * sem suspensão. O fã suspenso continua lendo o app, mas não grava nome e
   * cidade (a regra recusa) nem cria nada pela API (403 `account_suspended`).
   */
  suspendedAt?: string | null;
}

/** O que a tela "Editar perfil" grava direto no perfil: só o que mudou. */
export interface ProfileChanges {
  displayName?: string;
  /** `null` limpa a cidade. */
  city?: string | null;
}

/**
 * O @ que o fã digita, como o servidor vê (`GET /me/username/availability`):
 * livre, o de agora, de outro fã ou de uma central, fora do formato, ou
 * reservado (inclusive o padrão do automático, que só o servidor cria).
 */
export type UsernameStatus = 'available' | 'current' | 'taken' | 'invalid' | 'reserved';

/** Espelho do `UsernameAvailability` do `functions/src/api/contract.ts`: o @ normalizado. */
export interface UsernameAvailability {
  username: string;
  status: UsernameStatus;
}

/** `PUT /me/username`: as datas em ISO, `null` se o fã nunca trocou. */
export interface UsernameChange {
  username: string;
  changedAt: string | null;
  changeableAt: string | null;
}

/** `PUT` e `DELETE /me/photo`: a URL de download com token, ou `null`. */
export interface PhotoChange {
  photoURL: string | null;
}

/**
 * `POST /me/photo/upload`: a vaga do envio (o caminho e o fim do prazo, em ISO).
 * Sem ela, a regra do Storage recusa o arquivo (proteção contra abuso, 27.4).
 */
export interface PhotoUploadSlot {
  path: string;
  expiresAt: string;
}

/**
 * Os três contadores do fã (aprovados em 2026-09-28), todos decididos no
 * servidor: o app só lê.
 */
export interface Wallet {
  /** Saldo para trocar por recompensas; cai no resgate. */
  balance: number;
  /** Pontos de nível, que nunca caem. */
  xp: number;
  /** Pontos da temporada, que contam no ranking. */
  seasonPoints: number;
  /**
   * ISO da última gravação da carteira no servidor, ou `null` sem carteira
   * (bloco 10). A loja compara com o instante de uma recusa para buscar o
   * saldo de novo. Opcional: as fixtures e a carteira salva antes não têm.
   */
  updatedAt?: string | null;
}

/**
 * Convite do fã: o código que vai no `?ref=` dos links que ele compartilha e o
 * que cada pessoa trazida rende. O código nasce no servidor, no primeiro
 * `GET /me/invite`, e nunca muda; os valores vêm do painel admin pela API.
 */
export interface MyInvite {
  code: string;
  /** O link do atalho Convidar (`linkBase` mais `/?ref=<code>`). Campo do bloco 5. */
  url?: string;
  /** Base dos links que o fã compartilha: muda com o domínio, sem build nova. Campo do bloco 5. */
  linkBase?: string;
  /** Por pessoa que abre o link no app ("+2 por pessoa que abre o link no app"). */
  pointsPerVisit: number;
  /** Por pessoa que se cadastra pelo link. */
  pointsPerSignup: number;
}

/** Um degrau da régua de níveis, configurada no painel admin. */
export interface Level {
  number: number;
  /** "Purainha". */
  name: string;
  /** XP a partir do qual o fã está neste nível. */
  minXp: number;
}

/**
 * Os números do fã na 1e. O terceiro é provisório: no protótipo era
 * "playlists", fora do contrato (pergunta 7.3.2 para a cliente).
 */
export interface FanStats {
  /** Links de convite que o fã gerou. */
  linksCreated: number;
  /** Cadastros atribuídos aos links dele. */
  peopleBrought: number;
  /** Temporadas em que o fã pontuou. */
  seasons: number;
}

/**
 * Nível e números do fã (1e), decididos no servidor. O XP é o de nível, que
 * nunca cai (o resgate só desconta o saldo): o anel, a barra e o "Faltam ..."
 * leem daqui, e o número grande "SEUS PONTOS" é o saldo da carteira.
 */
export interface MyProgress {
  xp: number;
  level: Level;
  /** `null` no nível máximo. */
  nextLevel: Level | null;
  /** Pontos ganhos nos últimos 7 dias, sem descontar resgates ("+840"). */
  weekEarned: number;
  stats: FanStats;
}

/** Cor da conquista: rosa para ação e convite, lima para pontos e ranking, ciano para shows. */
export type AchievementTone = 'action' | 'points' | 'events';

export interface Achievement {
  id: string;
  /** "Boca a boca". */
  title: string;
  /**
   * Chave do ícone (`share`, `trophy`, `ticket`...). A lista vem do painel:
   * chave que o app não conhece cai num ícone genérico.
   */
  icon: string;
  tone: AchievementTone;
  /** ISO; `null` enquanto a conquista está bloqueada. */
  unlockedAt: string | null;
}

/** As conquistas do fã: a contagem e as que o perfil mostra (as últimas e a próxima). */
export interface MyAchievements {
  unlockedCount: number;
  totalCount: number;
  /** Na ordem do servidor: as últimas desbloqueadas e a próxima bloqueada. */
  highlights: Achievement[];
}

/** De onde veio um lançamento do extrato (o `source` do servidor). */
export type LedgerSource =
  | 'like'
  | 'comment'
  | 'rsvp'
  | 'central_join'
  | 'mission'
  | 'invite_visit'
  | 'invite_signup'
  | 'redeem'
  | 'redeem_refund'
  | 'adjustment'
  | 'seed';

/**
 * Uma linha do extrato de pontos (`GET /me/ledger`, blocos 1, 7 e 10). O app
 * mostra de onde veio, o contexto (a central, o título da missão ou o da
 * recompensa), o valor e a data. O `id` é só a chave da lista: nunca aparece.
 */
export interface LedgerEntry {
  id: string;
  /** `refund` é a devolução do resgate recusado pela equipe (bloco 10). */
  kind: 'earn' | 'spend' | 'adjust' | 'refund';
  /** Origem conhecida ou outra que o app ainda não conhece (cai em "Pontos"). */
  source: LedgerSource | (string & {});
  /** Quanto o saldo mexeu: positivo no ganho, negativo no resgate. */
  points: number;
  xpDelta: number;
  seasonDelta: number;
  artistId: string | null;
  centralSeasonDelta: number;
  centralTotalDelta: number;
  subject: { type: string; id: string } | null;
  /** ISO. */
  createdAt: string;
  /** O nome da central (bloco 7); `null` sem central ou com ela apagada. */
  artistName?: string | null;
  /**
   * O título da missão quando concluiu (bloco 7) ou o da recompensa no resgate
   * e na devolução (bloco 10).
   */
  subjectTitle?: string | null;
}

/** Uma página do extrato: `nextCursor` null na última. */
export interface LedgerPage {
  items: LedgerEntry[];
  nextCursor: string | null;
}
