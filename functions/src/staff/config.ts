import { defineSecret, defineString } from 'firebase-functions/params';

import type { EmailConfig } from './email';

/**
 * Origens que chamam as funções da equipe pelo navegador: o painel publicado
 * na Vercel (projeto imagineup-admin) e o local, para desenvolvimento. Quando
 * o painel ganhar domínio próprio, o endereço novo entra aqui. No emulador
 * (`FUNCTIONS_EMULATOR === 'true'`), também o painel local nas portas 3001 a
 * 3009, para as trilhas do bloco 11 conferirem as telas ao mesmo tempo, cada
 * uma na sua porta (26.5); em produção, a lista não muda.
 */
export function panelOrigins(env: Record<string, string | undefined>): string[] {
  const origins = ['https://imagineup-admin.vercel.app', 'http://localhost:3000'];
  if (env.FUNCTIONS_EMULATOR !== 'true') return origins;
  for (let port = 3001; port <= 3009; port += 1) origins.push(`http://localhost:${port}`);
  return origins;
}

/** As origens desta execução (lidas quando o módulo carrega, antes de as funções serem definidas). */
export const PANEL_ORIGINS = panelOrigins(process.env);

/** Painel local do Next.js, usado quando PANEL_URL não foi definido. */
export const DEFAULT_PANEL_URL = 'http://localhost:3000';

/**
 * Chave privada do EmailJS (Secret Manager; no emulador, functions/.secret.local).
 * Só as funções que mandam e-mail a recebem.
 */
export const EMAILJS_PRIVATE_KEY = defineSecret('EMAILJS_PRIVATE_KEY');

/** Id do service no EmailJS (functions/.env.<projeto>). Vazio, o convite sai sem e-mail. */
export const EMAILJS_SERVICE_ID = defineString('EMAILJS_SERVICE_ID', { default: '' });

/** Id do template do convite no EmailJS (functions/.env.<projeto>). Vazio, sai sem e-mail. */
export const EMAILJS_TEMPLATE_ID = defineString('EMAILJS_TEMPLATE_ID', { default: '' });

/**
 * Chave pública da conta no EmailJS (functions/.env.<projeto>). Vazia, o
 * convite sai sem e-mail (emailStatus skipped) e o admin copia o link.
 */
export const EMAILJS_PUBLIC_KEY = defineString('EMAILJS_PUBLIC_KEY', { default: '' });

/** Endereço do painel, base do link do convite. */
export const PANEL_URL = defineString('PANEL_URL', { default: DEFAULT_PANEL_URL });

/** Configuração do EmailJS na hora da chamada (só nas funções que têm o secret). */
export function emailConfig(): EmailConfig {
  return {
    serviceId: EMAILJS_SERVICE_ID.value(),
    templateId: EMAILJS_TEMPLATE_ID.value(),
    publicKey: EMAILJS_PUBLIC_KEY.value(),
    privateKey: EMAILJS_PRIVATE_KEY.value(),
  };
}

/** Base do link do convite. O parâmetro vazio em tempo de execução volta ao padrão. */
export function panelUrl(): string {
  return PANEL_URL.value() || DEFAULT_PANEL_URL;
}
