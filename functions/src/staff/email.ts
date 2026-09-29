import * as logger from 'firebase-functions/logger';

import { ROLE_LABELS, type EmailStatus, type StaffRole } from './model';

/** Endpoint REST do EmailJS. */
export const EMAILJS_SEND_URL = 'https://api.emailjs.com/api/v1.0/email/send';

const TIMEOUT_MS = 10_000;
// O texto de erro do EmailJS vai para o log; limite para não encher o log.
const LOG_TEXT_MAX = 300;

export type EmailConfig = {
  serviceId: string;
  templateId: string;
  publicKey: string;
  privateKey: string;
};

/** Variáveis do template do convite no EmailJS. */
export type InviteEmailParams = {
  to_email: string;
  to_name: string;
  inviter_name: string;
  role_label: string;
  invite_link: string;
  expires_label: string;
};

/** Sem service, template ou chave pública, o envio fica de fora (emailStatus skipped). */
export function emailConfigured(config: EmailConfig): boolean {
  return Boolean(config.serviceId && config.templateId && config.publicKey);
}

const EXPIRES_FORMAT = new Intl.DateTimeFormat('pt-BR', {
  day: 'numeric',
  month: 'long',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

/** Validade no e-mail, no horário de Brasília: "6 de outubro, 14:30". */
export function expiresLabel(date: Date): string {
  const parts = Object.fromEntries(
    EXPIRES_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.day} de ${parts.month}, ${parts.hour}:${parts.minute}`;
}

/**
 * Variáveis do e-mail. Sem nome sugerido, `to_name` vai vazio: o template
 * escreve `Olá{{#to_name}}, {{to_name}}{{/to_name}}!`, que sai "Olá!".
 */
export function inviteEmailParams(invite: {
  email: string;
  suggestedName: string | null;
  inviterName: string;
  role: StaffRole;
  inviteUrl: string;
  expiresAt: Date;
}): InviteEmailParams {
  return {
    to_email: invite.email,
    to_name: invite.suggestedName ?? '',
    inviter_name: invite.inviterName,
    role_label: ROLE_LABELS[invite.role],
    invite_link: invite.inviteUrl,
    expires_label: expiresLabel(invite.expiresAt),
  };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
type Warn = (message: string, data: Record<string, unknown>) => void;

/**
 * Manda o convite pelo EmailJS. Qualquer resposta que não seja 200 conta como
 * falha: o convite continua valendo e o admin copia o link. O log leva o
 * status e o texto da resposta, nunca a chave privada nem o link. `io` troca
 * a rede e o log nos testes.
 */
export async function sendInviteEmail(
  config: EmailConfig,
  params: InviteEmailParams,
  io: { fetch?: Fetch; warn?: Warn } = {},
): Promise<EmailStatus> {
  if (!emailConfigured(config)) return 'skipped';
  const fetchImpl = io.fetch ?? fetch;
  const warn = io.warn ?? logger.warn;
  const redact = (text: string) =>
    [config.privateKey, params.invite_link, params.invite_link.split('#')[1] ?? '']
      .filter((secret) => secret.length > 0)
      .reduce((clean, secret) => clean.split(secret).join('[omitido]'), text)
      .slice(0, LOG_TEXT_MAX);
  try {
    const response = await fetchImpl(EMAILJS_SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service_id: config.serviceId,
        template_id: config.templateId,
        user_id: config.publicKey,
        ...(config.privateKey ? { accessToken: config.privateKey } : {}),
        template_params: params,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200) return 'sent';
    const text = await response.text().catch(() => '');
    warn('O EmailJS recusou o e-mail do convite.', {
      status: response.status,
      text: redact(text),
    });
    return 'failed';
  } catch (error) {
    warn('O EmailJS não respondeu ao e-mail do convite.', {
      error: redact(error instanceof Error ? error.message : String(error)),
    });
    return 'failed';
  }
}
