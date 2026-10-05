import { defineSecret } from 'firebase-functions/params';

/**
 * Segredo do HMAC da chave da pessoa (docs/arquitetura-api.md, 20.1, decisão
 * 4), no Secret Manager; no emulador, em functions/.secret.local (o
 * scripts/functions-emulator-env.mjs grava o valor de EMULATOR_INVITE_KEY, o
 * mesmo do seed e dos testes). Só a função `api` o recebe. Criado uma vez pelo
 * dono, com um valor aleatório que não passa pelo repositório, e nunca muda:
 * cada pessoa já convidada pagaria e contaria de novo (20.16 e 20.17).
 */
export const INVITE_KEY_SECRET = defineSecret('INVITE_KEY_SECRET');
