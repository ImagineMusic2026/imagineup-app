/**
 * Endereço dos links que o fã compartilha. Provisório: o site do ImagineUP na
 * Vercel até o domínio próprio (UP-46) e os Universal Links e App Links, que
 * dependem dele e do Team ID da Apple. Do outro lado, o `+native-intent` lê o
 * `?ref=` de qualquer link que abra o app.
 *
 * Pendente: o site ainda não tem as páginas do app (`/post/ID/`,
 * `/artista/ID/`), e quem abre o link no navegador cai no 404 dele. A saída
 * proposta é o site mandar esses caminhos para `/baixar/` (rewrite no
 * `vercel.json` do repositório `imagineup-LP`), mantendo o caminho e o
 * `?ref=` para quando os App Links existirem; decisão do dono.
 */
export const SHARE_LINK_BASE = 'https://imagineup-painel.vercel.app';
