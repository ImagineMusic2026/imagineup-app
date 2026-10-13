/**
 * Endereços fixos que o app abre (seção 29 de docs/arquitetura-api.md,
 * decisão 15). A troca de domínio (UP-46) ou de e-mail sai por EAS Update.
 *
 * Termos de uso e política de privacidade, publicados no site do ImagineUP
 * (repositório `imagineup-LP`, projeto `imagineup-painel` da Vercel). Endereço
 * provisório até o domínio próprio (UP-46); a barra no fim evita o
 * redirecionamento do `trailingSlash`.
 */
export const TERMS_URL = 'https://imagineup-painel.vercel.app/termos/';
export const PRIVACY_URL = 'https://imagineup-painel.vercel.app/privacidade/';

/**
 * O e-mail de contato da equipe, o único do site (provisório até a resposta
 * da cliente, pergunta 1 de 29.15). Fonte única: nenhum texto do
 * `translations.json` escreve o endereço; as frases que o mostram usam
 * `{{email}}`, preenchido daqui, e um teste confere.
 */
export const SUPPORT_EMAIL = 'music@imaginegroup.com.br';
