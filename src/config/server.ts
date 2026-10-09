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
 * `EXPO_PUBLIC_API_URL`, a `api` de produção nos três ambientes da EAS
 * (preview desde 08/10/2026 e, pela resposta 10 de 28.15 de
 * docs/arquitetura-api.md, development e production também): entra no bundle
 * quando ele é gerado, então vale nas builds e nos EAS Updates novos. Vazio só
 * no Expo Go ou no dev client sem a variável no `.env` e sem emulador.
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

/** Porta do emulador do Storage (`firebase.json`). */
const STORAGE_EMULATOR_PORT = 9199;

// O host com que as funções no emulador montam a URL de download: o computador
// visto dele mesmo, na porta do emulador do Storage.
const LOCAL_STORAGE_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):9199\//;

/**
 * A URL de uma imagem como o aparelho alcança. Com o emulador, a URL que as
 * funções devolvem (a foto do fã, bloco 9) tem o host do emulador do Storage
 * visto do computador (`http://127.0.0.1:9199/...`), que o emulador Android
 * não alcança (lá o computador é `10.0.2.2`): troca pelo host do
 * `EXPO_PUBLIC_FIREBASE_EMULATOR_HOST`. Sem emulador, ou com outra URL (a de
 * produção, outra porta), passa como veio (docs/arquitetura-api.md, 24.1,
 * decisão 14).
 */
export function resolveMediaUrl(url: string, emulatorHost: string | undefined): string {
  if (!emulatorHost) return url;
  return url.replace(LOCAL_STORAGE_ORIGIN, `http://${emulatorHost}:${STORAGE_EMULATOR_PORT}/`);
}

/** `resolveMediaUrl` com o host dos emuladores deste build (o `Avatar` e o `RemoteImage` usam). */
export function mediaUrl(url: string): string {
  return resolveMediaUrl(url, firebaseEmulatorHost);
}
