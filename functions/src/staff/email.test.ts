import { describe, expect, it, vi } from 'vitest';

import {
  EMAILJS_SEND_URL,
  emailConfigured,
  expiresLabel,
  inviteEmailParams,
  sendInviteEmail,
  type EmailConfig,
} from './email';

const config: EmailConfig = {
  serviceId: 'service_x',
  templateId: 'template_x',
  publicKey: 'publica',
  privateKey: 'chave-privada-secreta',
};

const params = inviteEmailParams({
  email: 'camila@imagine.music',
  suggestedName: 'Camila',
  inviterName: 'Talis',
  role: 'viewer',
  inviteUrl: 'http://localhost:3000/convite/abc#token-secreto',
  // 6/10/2026 17:30 UTC = 14:30 em Brasília.
  expiresAt: new Date(Date.UTC(2026, 9, 6, 17, 30)),
});

describe('texto do e-mail', () => {
  it('validade no horário de Brasília', () => {
    expect(expiresLabel(new Date(Date.UTC(2026, 9, 6, 17, 30)))).toBe('6 de outubro, 14:30');
    // 02:05 UTC ainda é o dia anterior em Brasília.
    expect(expiresLabel(new Date(Date.UTC(2026, 0, 1, 2, 5)))).toBe('31 de dezembro, 23:05');
    expect(expiresLabel(new Date(Date.UTC(2026, 2, 9, 3, 0)))).toBe('9 de março, 00:00');
  });

  it('variáveis do template', () => {
    expect(params).toEqual({
      to_email: 'camila@imagine.music',
      to_name: 'Camila',
      inviter_name: 'Talis',
      role_label: 'Leitor',
      invite_link: 'http://localhost:3000/convite/abc#token-secreto',
      expires_label: '6 de outubro, 14:30',
    });
  });

  it('sem nome sugerido, o nome vai vazio (o template escreve só "Olá!")', () => {
    const anonymous = inviteEmailParams({
      email: 'x@y.io',
      suggestedName: null,
      inviterName: 'Equipe ImagineUP',
      role: 'admin',
      inviteUrl: 'u',
      expiresAt: new Date(),
    });
    expect(anonymous.to_name).toBe('');
    expect(anonymous.role_label).toBe('Admin');
  });
});

describe('envio pelo EmailJS', () => {
  it('sem service, template ou chave pública, nem chama a API', async () => {
    const fetch = vi.fn();
    for (const missing of ['serviceId', 'templateId', 'publicKey'] as const) {
      const partial = { ...config, [missing]: '' };
      expect(emailConfigured(partial)).toBe(false);
      expect(await sendInviteEmail(partial, params, { fetch })).toBe('skipped');
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('manda o JSON da API REST com a chave privada e um prazo de 10 s', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('OK'));
    expect(await sendInviteEmail(config, params, { fetch })).toBe('sent');
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(EMAILJS_SEND_URL);
    expect(init.method).toBe('POST');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      service_id: 'service_x',
      template_id: 'template_x',
      user_id: 'publica',
      accessToken: 'chave-privada-secreta',
      template_params: params,
    });
  });

  it('qualquer resposta que não seja 200 é falha, e o log não leva chave nem link', async () => {
    const warn = vi.fn();
    const echo = `sem permissão para chave-privada-secreta em ${params.invite_link}`;
    const fetch = vi.fn(async () => new Response(echo, { status: 403 }));
    expect(await sendInviteEmail(config, params, { fetch, warn })).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('403');
    expect(logged).not.toContain('chave-privada-secreta');
    expect(logged).not.toContain('token-secreto');
  });

  it('rede fora do ar ou prazo estourado é falha', async () => {
    const warn = vi.fn();
    const fetch = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    expect(await sendInviteEmail(config, params, { fetch, warn })).toBe('failed');
    expect(warn).toHaveBeenCalledOnce();
  });
});
