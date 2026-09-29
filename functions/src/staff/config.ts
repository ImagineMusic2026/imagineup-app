import { defineSecret, defineString } from 'firebase-functions/params';

import type { EmailConfig } from './email';

/**
 * Origens que chamam as funções da equipe pelo navegador. O endereço de
 * produção do painel entra aqui quando ele for publicado na Vercel.
 */
export const PANEL_ORIGINS = ['http://localhost:3000'];

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
