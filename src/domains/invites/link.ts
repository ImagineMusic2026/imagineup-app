import { SHARE_LINK_BASE } from './consts';

/**
 * Link de uma página do app com o código de convite do fã (`?ref=CODIGO`), para
 * quem abrir cair na página e o convite ser atribuído a ele. Sem código (ainda
 * não carregou), sai o link puro: compartilhar continua funcionando, só não
 * rende pontos. Puro e sem Firebase, como o resto do `index.ts` deste domínio.
 */
export function buildInviteUrl(code: string | null, path: string): string {
  const page = path.startsWith('/') ? path : `/${path}`;
  if (!code) return `${SHARE_LINK_BASE}${page}`;
  const separator = page.includes('?') ? '&' : '?';
  return `${SHARE_LINK_BASE}${page}${separator}ref=${encodeURIComponent(code)}`;
}
