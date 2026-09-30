import { API_ERROR_CODES, ApiError } from '@/services/api/errors';

/**
 * Ajudantes das fixtures, usadas enquanto a API (M2) não existe. Aqui não mora
 * dado de domínio: cada domínio tem o seu `fixtures.ts`, e o `api.ts` escolhe
 * entre ele e a API pelo `dataSource` de `@/config/env`.
 */

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

  /** Resgate: desconta só do saldo e recusa sem saldo, como a API faria. */
  spend(points: number): FixtureWalletState {
    assertPoints(points);
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
  for (const reset of sessionResets) reset();
}
