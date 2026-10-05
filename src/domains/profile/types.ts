/**
 * Perfil básico do fã, lido de `users/{uid}` no Firestore. Nasce no servidor
 * (função `createUserProfile`) alguns segundos depois do cadastro; o celular só
 * lê o próprio e, quando a edição entrar, muda `displayName` e `city`.
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
