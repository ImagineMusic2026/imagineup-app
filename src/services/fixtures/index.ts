import { sourceOf } from '@/config/data-source';
import { API_ERROR_CODES, ApiError } from '@/services/api/errors';

/**
 * Ajudantes das fixtures, usadas pelos domínios que ainda não têm rota no
 * servidor. Aqui não mora dado de domínio: cada domínio tem o seu
 * `fixtures.ts`, e o `api.ts` escolhe entre ele e a API pelo `sourceOf` de
 * `@/config/data-source`.
 */

/**
 * Recusa do resgate de fixture quando a carteira vem da API: o resgate
 * gastaria um saldo que não é o da tela. É das fixtures, não da API (por isso
 * não mora em `API_ERROR_CODES`), e o app mostra o erro genérico do resgate.
 */
export const FIXTURE_POINTS_UNAVAILABLE = 'points_unavailable';

// No app, a espera deixa o esqueleto aparecer como apareceria com a rede. No
// Jest não há espera, para os testes não dependerem de timer.
const FIXTURE_DELAY_MS = process.env.NODE_ENV === 'test' ? 0 : 400;

export function fixtureDelay(ms: number = FIXTURE_DELAY_MS): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let pinnedNow: Date | null = null;

/** Relógio das fixtures. Datas de exemplo são sempre relativas a ele. */
export function fixtureNow(): Date {
  return pinnedNow ? new Date(pinnedNow.getTime()) : new Date();
}

/** Prende o relógio numa data (testes); `null` volta ao relógio do aparelho. */
export function setFixtureNow(date: Date | null): void {
  pinnedNow = date ? new Date(date.getTime()) : null;
}

/** Os três contadores do fã: saldo (troca por recompensa), XP (nível) e temporada (ranking). */
export interface FixtureWalletState {
  balance: number;
  xp: number;
  seasonPoints: number;
}

// Saldo e XP começam iguais para as telas baterem com o protótipo (12.480);
// o primeiro resgate separa os dois, porque o nível não cai no resgate.
const INITIAL_WALLET: FixtureWalletState = { balance: 12_480, xp: 12_480, seasonPoints: 4_120 };

let wallet: FixtureWalletState = { ...INITIAL_WALLET };
// Soma de tudo o que o fã ganhou desde que o app abriu (resgate não conta).
let earnedSinceStart = 0;

function assertPoints(points: number): void {
  if (!Number.isInteger(points) || points < 0) {
    throw new RangeError(`Pontos inválidos na fixture: ${points}`);
  }
}

/**
 * A carteira é o único estado de "servidor" que atravessa domínios: o resgate
 * da 1h desconta, e a 1e, a 1h e o card "Você" da 1f leem. Fica em memória e
 * volta ao início quando o app reabre ou a sessão termina. Os valores são de
 * exemplo; os reais vêm da API e do painel.
 */
export const fixtureWallet = {
  get(): FixtureWalletState {
    return { ...wallet };
  },

  /** Ganho de pontos: soma nos três contadores. */
  earn(points: number): FixtureWalletState {
    assertPoints(points);
    wallet = {
      balance: wallet.balance + points,
      xp: wallet.xp + points,
      seasonPoints: wallet.seasonPoints + points,
    };
    earnedSinceStart += points;
    return fixtureWallet.get();
  },

  /**
   * Quanto o fã ganhou desde que o app abriu, sem descontar resgates: o que o
   * "Esta semana" do perfil (1e) soma aos ganhos de exemplo da semana.
   */
  earned(): number {
    return earnedSinceStart;
  },

  /**
   * Resgate: desconta só do saldo e recusa sem saldo, como a API faria. Com a
   * carteira na API, recusa sempre (`points_unavailable`): o ponto existe num
   * lugar só, e o saldo da tela é o do servidor.
   */
  spend(points: number): FixtureWalletState {
    assertPoints(points);
    if (sourceOf('wallet') === 'api') {
      throw new ApiError(
        'validation',
        'Os pontos vêm do servidor: o resgate de exemplo não gasta.',
        409,
        FIXTURE_POINTS_UNAVAILABLE,
      );
    }
    if (points > wallet.balance) {
      throw new ApiError(
        'validation',
        'Saldo insuficiente.',
        409,
        API_ERROR_CODES.insufficientPoints,
      );
    }
    wallet = { ...wallet, balance: wallet.balance - points };
    return fixtureWallet.get();
  },

  /** Volta aos valores iniciais (fim da sessão e testes). */
  reset(): void {
    wallet = { ...INITIAL_WALLET };
    earnedSinceStart = 0;
  },
};

/**
 * Pontos que uma ação de fixture rende (comentar, entrar na central, concluir
 * missão). Ponto existe num lugar só: com a carteira nas fixtures, soma na
 * `fixtureWallet` e devolve os pontos; com a carteira na API, não soma nada e
 * devolve 0, para a tela não mostrar um "+N" que o saldo do servidor não tem.
 * Quando o domínio da ação passa para a API, o servidor volta a dar os pontos
 * (docs/arquitetura-api.md, seção 13).
 */
export function earnFixturePoints(points: number): number {
  assertPoints(points);
  if (sourceOf('wallet') === 'api') return 0;
  fixtureWallet.earn(points);
  return points;
}

/** As centrais de que o fã de exemplo (a Camila do protótipo) é membro no começo. */
const INITIAL_MEMBERSHIP: readonly string[] = ['nettobrito', 'nenho', 'juninhomoraes'];

let members = new Set<string>(INITIAL_MEMBERSHIP);

/**
 * De quais centrais o fã de exemplo é membro, para o ranking de exemplo de
 * cada central, que é só de membros, como o do servidor (bloco 8): quem sai
 * de uma central sai do ranking dela. O `followFixture` das centrais atualiza
 * ao entrar, seguir e sair; o ranking lê daqui, sem importar as centrais (o
 * `artists/fixtures.ts` já importa o ranking, e o contrário fecharia um ciclo).
 */
export const fixtureMembership = {
  isMember(artistId: string): boolean {
    return members.has(artistId);
  },

  join(artistId: string): void {
    members.add(artistId);
  },

  leave(artistId: string): void {
    members.delete(artistId);
  },

  /** Volta ao início (fim da sessão e testes). */
  reset(): void {
    members = new Set(INITIAL_MEMBERSHIP);
  },
};

// O `reset` do estado em memória de cada domínio (presenças, resgates,
// centrais seguidas, missões).
const sessionResets = new Set<() => void>();

/**
 * Registra o `reset` do "servidor" em memória de um domínio. As fixtures não
 * separam um fã do outro: quando a sessão termina (sair, excluir a conta,
 * outro fã entrar), tudo volta ao início, para o próximo fã não ver o saldo,
 * os resgates e as presenças do anterior. Some junto com as fixtures quando a
 * API entrar.
 */
export function onFixtureSessionEnd(reset: () => void): void {
  sessionResets.add(reset);
}

/** Volta a carteira e o estado de cada domínio ao início (fim da sessão). */
export function resetFixtureSession(): void {
  fixtureWallet.reset();
  fixtureMembership.reset();
  for (const reset of sessionResets) reset();
}
