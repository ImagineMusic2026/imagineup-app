/**
 * Termos de uso e política de privacidade, publicados no site do ImagineUP
 * (repositório `imagineup-painel`). Endereço provisório da Vercel até o domínio
 * próprio (UP-46); a barra no fim evita o redirecionamento do `trailingSlash`.
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
