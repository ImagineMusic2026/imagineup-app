import { z } from 'zod';

/**
 * Variáveis públicas do app. O Metro só injeta `EXPO_PUBLIC_*` quando o acesso
 * é estático (`process.env.EXPO_PUBLIC_X`), por isso cada uma aparece por extenso.
 */
const rawEnv = {
  firebaseApiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  firebaseAuthDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  firebaseProjectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  firebaseStorageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  firebaseMessagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  firebaseAppId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

// O endereço do servidor (emuladores ou API) mora em ./server: o seletor de
// fonte (data-source.ts) lê de lá sem passar pela configuração do Firebase.
export { apiUrl, EMULATOR_PROJECT_ID, firebaseEmulatorHost, resolveApiUrl } from './server';

const optionalString = z
  .string()
  .trim()
  .transform((value) => (value.length > 0 ? value : undefined))
  .optional();

export const firebaseEnvSchema = z.object({
  firebaseApiKey: z.string().trim().min(1),
  firebaseAuthDomain: z.string().trim().min(1),
  firebaseProjectId: z.string().trim().min(1),
  firebaseStorageBucket: optionalString,
  firebaseMessagingSenderId: optionalString,
  firebaseAppId: z.string().trim().min(1),
});

export type FirebaseEnv = z.infer<typeof firebaseEnvSchema>;

function parseFirebaseEnv(): FirebaseEnv | null {
  const result = firebaseEnvSchema.safeParse(rawEnv);
  if (result.success) return result.data;
  if (__DEV__) {
    const missing = result.error.issues.map((issue) => issue.path.join('.')).join(', ');
    console.warn(`[env] Firebase sem configuração (${missing}). Veja o .env.example.`);
  }
  return null;
}

/** `null` enquanto o .env não estiver preenchido: o app abre, mas não autentica. */
export const firebaseEnv = parseFirebaseEnv();

// O formato do ID do cliente do Google: o número do projeto, um hífen, um
// código e o sufixo do Google.
const GOOGLE_CLIENT_ID_PATTERN = /^[\w-]+\.apps\.googleusercontent\.com$/;

/**
 * O ID do cliente Web do Google, sem espaço nas pontas. Vazio ou fora do
 * formato vira `undefined`, e o Google fica desligado (o formato errado avisa
 * no console em desenvolvimento).
 */
export function parseGoogleWebClientId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (GOOGLE_CLIENT_ID_PATTERN.test(trimmed)) return trimmed;
  if (__DEV__) {
    console.warn(
      '[env] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID fora do formato. O Google fica desligado.',
    );
  }
  return undefined;
}

/**
 * O `webClientId` da entrada com o Google: o ID do cliente Web que o Firebase
 * cria ao ligar o Google no Auth (seção 33 de docs/arquitetura-api.md). Fica
 * fora do fingerprint, como as outras variáveis. Sem ele, o botão do Google
 * não aparece.
 */
export const googleWebClientId = parseGoogleWebClientId(
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
);
