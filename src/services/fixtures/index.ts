import { ApiError } from '@/services/api/errors';

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

/** Código que o resgate sem saldo devolve, como a API devolveria. */
export const INSUFFICIENT_POINTS_CODE = 'insufficient_points';

let wallet: FixtureWalletState = { ...INITIAL_WALLET };

function assertPoints(points: number): void {
  if (!Number.isInteger(points) || points < 0) {
    throw new RangeError(`Pontos inválidos na fixture: ${points}`);
  }
}

/**
 * A carteira é o único estado de "servidor" que atravessa domínios: o resgate
 * da 1h desconta, e a 1e, a 1h e o card "Você" da 1f leem. Fica em memória e
 * volta ao início quando o app reabre. Os valores são de exemplo; os reais
 * vêm da API e do painel.
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
    return fixtureWallet.get();
  },

  /** Resgate: desconta só do saldo e recusa sem saldo, como a API faria. */
  spend(points: number): FixtureWalletState {
    assertPoints(points);
    if (points > wallet.balance) {
      throw new ApiError('validation', 'Saldo insuficiente.', 409, INSUFFICIENT_POINTS_CODE);
    }
    wallet = { ...wallet, balance: wallet.balance - points };
    return fixtureWallet.get();
  },

  /** Volta aos valores iniciais (testes). */
  reset(): void {
    wallet = { ...INITIAL_WALLET };
  },
};
