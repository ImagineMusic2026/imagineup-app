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
  apiUrl: process.env.EXPO_PUBLIC_API_URL,
  firebaseEmulatorHost: process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST,
};

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

export const apiUrl = optionalString.parse(rawEnv.apiUrl);

/**
 * Host dos emuladores do Firebase (`npm run emulators`), só em desenvolvimento:
 * uma build nunca aponta para eles, mesmo que a variável exista.
 */
export const firebaseEmulatorHost = __DEV__
  ? optionalString.parse(rawEnv.firebaseEmulatorHost)
  : undefined;
