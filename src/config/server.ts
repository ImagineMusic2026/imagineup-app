/**
 * Onde fica o servidor do app: os emuladores do Firebase em desenvolvimento ou
 * a API publicada. Mora à parte do `env.ts` (que reexporta tudo daqui) para o
 * seletor de fonte (`data-source.ts`), que as fixtures e o cache importam, não
 * puxar a leitura da configuração do Firebase. Como no `env.ts`, cada
 * `EXPO_PUBLIC_*` aparece por extenso: o Metro só injeta acesso estático.
 */

/** Texto da variável sem espaço nas pontas; vazio vira `undefined`. */
function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Host dos emuladores do Firebase (`npm run emulators`), só em desenvolvimento:
 * uma build nunca aponta para eles, mesmo que a variável exista.
 */
export const firebaseEmulatorHost = __DEV__
  ? optionalText(process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST)
  : undefined;

/**
 * Projeto demo dos emuladores (`npm run emulators`): o que não estiver
 * emulado falha, em vez de cair no imagine-up-app de verdade. O endereço da
 * API do emulador também usa.
 */
export const EMULATOR_PROJECT_ID = 'demo-imagine-up-app';

/** Região das Cloud Functions, a mesma do Firestore. */
const FUNCTIONS_REGION = 'southamerica-east1';

/**
 * Endereço da API do app (função `api` nas Cloud Functions). Com os
 * emuladores, é a `api` do emulador de Functions, montada a partir do host
 * deles, sem variável nova; o `EXPO_PUBLIC_API_URL` fica de fora, porque o
 * token do emulador não vale na API de verdade. Sem emulador, o
 * `EXPO_PUBLIC_API_URL`, que fica vazio nas builds até as ações que rendem e
 * gastam pontos estarem na API (docs/arquitetura-api.md, seção 13).
 */
export function resolveApiUrl(
  emulatorHost: string | undefined,
  publicApiUrl: string | undefined,
): string | undefined {
  if (emulatorHost) {
    return `http://${emulatorHost}:5001/${EMULATOR_PROJECT_ID}/${FUNCTIONS_REGION}/api`;
  }
  return publicApiUrl;
}

export const apiUrl = resolveApiUrl(
  firebaseEmulatorHost,
  optionalText(process.env.EXPO_PUBLIC_API_URL),
);
