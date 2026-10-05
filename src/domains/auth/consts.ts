/**
 * Termos de uso e política de privacidade, publicados no site do ImagineUP
 * (repositório `imagineup-LP`, projeto `imagineup-painel` da Vercel). Endereço
 * provisório até o domínio próprio (UP-46); a barra no fim evita o
 * redirecionamento do `trailingSlash`.
 */
export const TERMS_URL = 'https://imagineup-painel.vercel.app/termos/';
export const PRIVACY_URL = 'https://imagineup-painel.vercel.app/privacidade/';

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
