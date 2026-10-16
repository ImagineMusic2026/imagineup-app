/**
 * Termos de uso e política de privacidade: os endereços moram em
 * `src/config/links.ts`, com o e-mail de contato (seção 29, decisão 15).
 */
export { PRIVACY_URL, TERMS_URL } from '@/config/links';

/**
 * Quanto o cadastro espera o perfil (`users/{uid}`) nascer na função de
 * cadastro. Passou disso, o app libera do mesmo jeito e o perfil chega depois.
 */
export const PROFILE_WAIT_MS = 20_000;

/**
 * Etapas da barra do cadastro e da escolha de artistas (1l): o cadastro é a 1
 * e os artistas, a 2. O protótipo desenha 3 segmentos, mas a terceira etapa
 * não foi definida.
 */
export const ENTRY_STEP_COUNT = 2;

/**
 * Quanto o cadastro espera o claim do código digitado no campo "Código de
 * convite": recusado (não existe ou não vale), a tela fica para o fã corrigir
 * ou seguir sem ele. Passou disso, segue, e a sincronização manda depois.
 */
export const INVITE_CLAIM_WAIT_MS = 8_000;

/**
 * Novas rodadas da sincronização do convite depois de uma falha de resultado
 * incerto, na mesma sessão: 30 s, 2 min e 10 min. O caso comum é o 503
 * `profile_not_ready` logo depois do cadastro (o perfil passou dos 20 s).
 */
export const INVITE_SYNC_RETRY_MS: readonly number[] = [30_000, 120_000, 600_000];

/**
 * Até quando o convite guardado vira visita para quem entra numa conta que
 * já existe: mais velho, num aparelho dividido, pode ser de outra pessoa.
 */
export const VISIT_FRESH_MS = 24 * 60 * 60 * 1000;

/**
 * A conta nasceu neste aparelho e ninguém entrou nela desde então: o último
 * login fica até 1 min depois da criação (o próprio cadastro).
 */
export const FRESH_ACCOUNT_SIGN_IN_MS = 60_000;

/** A conta que nasceu depois do link amarra o convite sozinha até 7 dias depois. */
export const AUTO_BIND_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Quanto a entrada numa conta que já existe espera o `GET /me/centrals` para
 * decidir a escolha de artistas (seção 33, decisão 11) e, com o nome guardado
 * da Apple, a leitura do perfil. Passou disso, segue com o que o aparelho tem.
 */
export const EXISTING_ACCOUNT_CHECK_MS = 3_000;

/** O prazo da revogação do token da Apple na exclusão da conta (seção 33, decisão 12). */
export const APPLE_REVOKE_TIMEOUT_MS = 10_000;

/**
 * O bundle ID do app no iOS, o `BUNDLE_ID` do `app.config.ts` (um teste
 * confere os dois). Vai no cabeçalho `X-Ios-Bundle-Identifier` da revogação
 * da Apple, como o SDK do Firebase para iOS manda em todo pedido: o código da
 * Apple é emitido para ele (seção 33, decisão 12).
 */
export const IOS_BUNDLE_ID = 'br.com.imaginegroup.imagineup';
