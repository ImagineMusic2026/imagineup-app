/**
 * Contrato com a API da agenda (bloco 6, docs/arquitetura-api.md, seção 21),
 * espelho de `functions/src/api/contract.ts`: mudou um, mude o outro.
 *
 * Presença em show ("Eu vou"): nasce no post de show da home (1b, aprovado em
 * 2026-09-29) e é a mesma da agenda (1m). As presenças do fã moram numa lista
 * só (`MyRsvps`), e o feed e a agenda leem dela, para o "Eu vou" dos dois
 * lugares nunca discordar. Por isso o show não traz "eu vou" próprio.
 */
export interface MyRsvps {
  /** Shows em que o fã confirmou presença. */
  eventIds: string[];
}

export interface RsvpVariables {
  eventId: string;
  /** `true` confirma, `false` desfaz. */
  going: boolean;
  /** A mesma chave numa repetição (fila offline, rede que caiu) não conta duas vezes. */
  idempotencyKey: string;
}

export interface RsvpResult {
  eventId: string;
  going: boolean;
  /**
   * Pontos que a confirmação rendeu (a primeira presença conta na missão
   * "Confirme presença em um show"). Zero no resto, e sempre zero ao desfazer.
   */
  pointsAwarded: number;
}

export interface AgendaArtist {
  id: string;
  /** "Netto Brito". */
  name: string;
}

/** Um show da agenda (1m). */
export interface AgendaEvent {
  id: string;
  /** "São João de Irará". */
  title: string;
  /** Quem toca. A meta do destaque junta os nomes com " + ". */
  artists: AgendaArtist[];
  /** "Irará". */
  city: string;
  /** UF: "BA". */
  state: string;
  /** ISO com fuso. O app mostra dia, mês e hora no fuso do aparelho. */
  startsAt: string;
  /** Foto do show (slot `up-1m-ev1`, só o destaque mostra); `null` mostra o bloco ciano. */
  imageUrl: string | null;
  /**
   * Pontos por pessoa que se cadastra pelo link do "Chamar amigos" (regra do
   * convite, ajustável no painel). `null` esconde o "+N".
   */
  invitePointsPerSignup: number | null;
  /**
   * O local do show (campo novo do bloco 6, opcional): guardado, ainda não
   * mostrado (pergunta 5 de 21.16).
   */
  venue?: string | null;
}

/** Uma página da agenda: shows futuros em ordem de data. */
export interface AgendaPage {
  /**
   * O show marcado no painel para o topo da agenda, só na primeira página
   * (`null` nas outras e sem nenhum marcado; aí o destaque é o próximo show).
   * Fica fora da paginação: marcado para daqui a meses, ele cairia numa
   * página que o fã ainda não carregou, e o topo trocaria no "Ver agenda
   * completa". Pode vir também em `items`, na data dele; a tela não o repete.
   */
  featured: AgendaEvent | null;
  items: AgendaEvent[];
  nextCursor: string | null;
}
