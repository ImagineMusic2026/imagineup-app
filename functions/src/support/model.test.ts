import { describe, expect, it } from 'vitest';

import {
  DEVICE_FIELD_MAX,
  isSupportMessageId,
  parseSupportMessage,
  statusAfter,
  SUPPORT_KINDS,
  SUPPORT_MESSAGES_PER_DAY,
  SUPPORT_TEXT_MAX,
} from './model';
import { parseSupportResolution } from './panel';

// O Suporte dos Ajustes (seção 38 de docs/arquitetura-api.md): o corpo do
// POST /me/support e o da callable resolveSupportMessage, puros.

const DEVICE = { platform: 'android', osVersion: '14', appVersion: '0.1.0', updateId: '01a1a459' };

describe('os números do Suporte (38.1)', () => {
  it('três tipos, até 2.000 caracteres e 5 por dia', () => {
    expect(SUPPORT_KINDS).toEqual(['problem', 'idea', 'feedback']);
    expect(SUPPORT_TEXT_MAX).toBe(2_000);
    expect(SUPPORT_MESSAGES_PER_DAY).toBe(5);
    expect(DEVICE_FIELD_MAX).toBe(40);
  });
});

describe('parseSupportMessage (38.2)', () => {
  it('o problema com o aparelho, o texto limpo', () => {
    expect(
      parseSupportMessage({
        kind: 'problem',
        text: '  A agenda trava.\r\n\n\n Duas vezes.  ',
        device: DEVICE,
      }),
    ).toEqual({
      ok: true,
      value: { kind: 'problem', text: 'A agenda trava.\n\nDuas vezes.', device: DEVICE },
    });
  });

  it('a sugestão e o feedback sem aparelho, com o device ausente ou null', () => {
    expect(parseSupportMessage({ kind: 'idea', text: 'Salvar posts.' })).toEqual({
      ok: true,
      value: { kind: 'idea', text: 'Salvar posts.', device: null },
    });
    expect(parseSupportMessage({ kind: 'feedback', text: 'Amei!', device: null })).toEqual({
      ok: true,
      value: { kind: 'feedback', text: 'Amei!', device: null },
    });
  });

  it('o aparelho com os textos ausentes vale null, e o sistema é obrigatório', () => {
    expect(
      parseSupportMessage({ kind: 'problem', text: 'Trava.', device: { platform: 'ios' } }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'problem',
        text: 'Trava.',
        device: { platform: 'ios', osVersion: null, appVersion: null, updateId: null },
      },
    });
  });

  it.each([
    ['o corpo que não é objeto', 'oi', 'body'],
    ['a lista', [], 'body'],
    ['a chave desconhecida', { kind: 'idea', text: 'oi', email: 'a@b.c' }, 'email'],
    ['o tipo fora da lista', { kind: 'bug', text: 'oi' }, 'kind'],
    ['o tipo ausente', { text: 'oi' }, 'kind'],
    ['o texto que não é texto', { kind: 'idea', text: 3 }, 'text'],
    ['o texto vazio', { kind: 'idea', text: '   \n  ' }, 'text'],
    ['o texto acima de 2.000', { kind: 'idea', text: 'a'.repeat(2_001) }, 'text'],
    ['o texto bruto acima do dobro', { kind: 'idea', text: ' '.repeat(4_001) }, 'text'],
    ['a linha invisível', { kind: 'idea', text: 'oi\n​' }, 'text'],
    ['o problema sem aparelho', { kind: 'problem', text: 'oi' }, 'device'],
    ['o problema com o aparelho null', { kind: 'problem', text: 'oi', device: null }, 'device'],
    [
      'o sistema fora da lista',
      { kind: 'problem', text: 'oi', device: { ...DEVICE, platform: 'web' } },
      'device',
    ],
    [
      'a chave estranha no aparelho',
      { kind: 'problem', text: 'oi', device: { ...DEVICE, model: 'X' } },
      'device',
    ],
    [
      'a versão longa',
      { kind: 'problem', text: 'oi', device: { ...DEVICE, osVersion: '1'.repeat(41) } },
      'device',
    ],
    [
      'a versão vazia',
      { kind: 'problem', text: 'oi', device: { ...DEVICE, appVersion: '' } },
      'device',
    ],
    [
      'a versão em duas linhas',
      { kind: 'problem', text: 'oi', device: { ...DEVICE, updateId: 'a\nb' } },
      'device',
    ],
    ['a sugestão com aparelho', { kind: 'idea', text: 'oi', device: DEVICE }, 'device'],
  ])('recusa %s', (_name, body, field) => {
    expect(parseSupportMessage(body)).toEqual({ ok: false, field });
  });

  it('o texto de 2.000 passa, contado depois de limpo', () => {
    const text = `${'a'.repeat(2_000)}   `;
    expect(parseSupportMessage({ kind: 'feedback', text })).toMatchObject({ ok: true });
  });
});

describe('a resolução da equipe (38.3)', () => {
  it('o estado que cada ação deixa', () => {
    expect(statusAfter('resolve')).toBe('resolved');
    expect(statusAfter('reopen')).toBe('open');
  });

  it('o id automático e o do seed', () => {
    expect(isSupportMessageId('Kq3vZ8wQb1TnUe0aRk5p')).toBe(true);
    expect(isSupportMessageId('seed-suporte-problema')).toBe(true);
    expect(isSupportMessageId('a/b')).toBe(false);
    expect(isSupportMessageId('')).toBe(false);
    expect(isSupportMessageId(3)).toBe(false);
  });

  it('o corpo da callable', () => {
    expect(parseSupportResolution({ id: 'msg1', action: 'resolve' })).toEqual({
      id: 'msg1',
      action: 'resolve',
    });
    expect(() => parseSupportResolution({ id: 'a/b', action: 'resolve' })).toThrow(
      expect.objectContaining({ details: { reason: 'invalid-request', field: 'id' } }),
    );
    expect(() => parseSupportResolution({ id: 'msg1', action: 'delete' })).toThrow(
      expect.objectContaining({ details: { reason: 'invalid-request', field: 'action' } }),
    );
  });
});
