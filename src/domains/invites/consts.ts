/**
 * Endereço dos links que o fã compartilha. Provisório: o site do ImagineUP na
 * Vercel até o domínio próprio (UP-46) e os Universal Links e App Links, que
 * dependem dele e do Team ID da Apple. Do outro lado, o `+native-intent` lê o
 * `?ref=` de qualquer link que abra o app.
 *
 * Pendente: o site ainda não tem as páginas do app (`/post/ID/`,
 * `/artista/ID/`, `/agenda/`), e quem abre o link no navegador cai no 404
 * dele. A saída proposta é o site mandar esses caminhos para `/baixar/` (rewrite no
 * `vercel.json` do repositório `imagineup-LP`), mantendo o caminho e o
 * `?ref=` para quando os App Links existirem; decisão do dono.
 */
export const SHARE_LINK_BASE = 'https://imagineup-painel.vercel.app';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Quanto o convite guardado no aparelho (o link que abriu o app) vale: o
 * primeiro convite manda até vencer, e o vencido sai na leitura.
 */
export const PENDING_INVITE_TTL_MS = 7 * DAY_MS;

/**
 * Quanto o convite amarrado a uma conta (no cadastro) vale para a
 * sincronização tentar de novo, desde o `boundAt`. A janela do claim no
 * servidor também é de 7 dias desde o cadastro.
 */
export const BOUND_INVITE_TTL_MS = 7 * DAY_MS;

/** Tamanho de cada `utm_*` que vai ao servidor (ele recusa acima disso). */
export const INVITE_UTM_MAX = 200;

/** Tamanho do caminho do link que vai ao servidor (ele recusa acima disso). */
export const INVITE_PATH_MAX = 200;
