import { describe, expect, it } from 'vitest';

import { parseCurrentUsername, parseLookupEmail } from '../fan-profile/panel';
import { AUDIT_TARGETS_MAX, auditIndex } from '../staff/audit-index';
import {
  HIDE_FAN_COMMENTS_PAGE,
  parseSuspensionInput,
  SUSPENSION_NOTE_MAX,
  SUSPENSION_REASONS,
} from './fans';

// Os corpos das ferramentas do painel sobre um fã (bloco 11, 26.4), puros: a
// suspensão (motivo da lista, nota opcional numa linha), o e-mail da busca, o
// @ da troca e a página do `hideFanComments` nos alvos da auditoria.

const fieldOf = (run: () => unknown): unknown => {
  try {
    run();
  } catch (error) {
    return (error as { details?: { reason?: unknown; field?: unknown } }).details;
  }
  throw new Error('Deveria ter falhado.');
};

describe('parseSuspensionInput', () => {
  it('suspender pede o motivo da lista; a nota é opcional, numa linha visível', () => {
    expect(SUSPENSION_REASONS).toEqual(['spam', 'offensive', 'harassment', 'other']);
    expect(parseSuspensionInput('uidCamila', { suspended: true, reason: 'spam' })).toEqual({
      uid: 'uidCamila',
      suspended: true,
      reason: 'spam',
      note: null,
    });
    expect(
      parseSuspensionInput('uidCamila', {
        suspended: true,
        reason: 'other',
        note: '  Conta de teste  ',
      }).note,
    ).toBe('Conta de teste');
    expect(
      parseSuspensionInput('uidCamila', {
        suspended: true,
        reason: 'other',
        note: 'a'.repeat(SUSPENSION_NOTE_MAX),
      }).note,
    ).toHaveLength(SUSPENSION_NOTE_MAX);
  });

  it('tirar a suspensão vai sem motivo e sem nota', () => {
    expect(parseSuspensionInput('uidCamila', { suspended: false })).toEqual({
      uid: 'uidCamila',
      suspended: false,
      reason: null,
      note: null,
    });
    expect(parseSuspensionInput('uidCamila', { suspended: false, reason: null }).suspended).toBe(
      false,
    );
  });

  it.each([
    [{}, 'suspended'],
    [{ suspended: 'sim' }, 'suspended'],
    [{ suspended: true }, 'reason'],
    [{ suspended: true, reason: 'chato' }, 'reason'],
    [{ suspended: true, reason: 'spam', note: '' }, 'note'],
    [{ suspended: true, reason: 'spam', note: 'a'.repeat(SUSPENSION_NOTE_MAX + 1) }, 'note'],
    [{ suspended: true, reason: 'spam', note: 'duas\nlinhas' }, 'note'],
    [{ suspended: true, reason: 'spam', note: 7 }, 'note'],
    [{ suspended: false, reason: 'spam' }, 'reason'],
    [{ suspended: false, note: 'nota' }, 'note'],
  ])('recusa %j no campo %s', (fields, field) => {
    expect(fieldOf(() => parseSuspensionInput('uidCamila', fields))).toEqual({
      reason: 'invalid-request',
      field,
    });
  });
});

describe('parseLookupEmail', () => {
  it('em minúsculas e sem espaço nas pontas', () => {
    expect(parseLookupEmail('  Bia@Teste.ImagineUP ')).toBe('bia@teste.imagineup');
    expect(parseLookupEmail(`${'a'.repeat(240)}@teste.dev`)).toHaveLength(250);
  });

  it.each([undefined, 42, '', 'sem-arroba', '@teste.dev', 'bia@', 'bia@@teste.dev', 'b ia@x.dev'])(
    'recusa %j',
    (value) => {
      expect(fieldOf(() => parseLookupEmail(value))).toEqual({
        reason: 'invalid-request',
        field: 'email',
      });
    },
  );

  it('acima de 254 caracteres é pedido inválido', () => {
    expect(fieldOf(() => parseLookupEmail(`${'a'.repeat(250)}@x.dev`))).toEqual({
      reason: 'invalid-request',
      field: 'email',
    });
  });
});

describe('parseCurrentUsername', () => {
  it('o @ de agora, com ou sem o `@`, em qualquer caixa e com espaço nas pontas', () => {
    expect(parseCurrentUsername('camilarib')).toBe('camilarib');
    expect(parseCurrentUsername('  @CamilaRib ')).toBe('camilarib');
    expect(parseCurrentUsername('fa1234567')).toBe('fa1234567');
  });

  it.each([
    undefined,
    null,
    42,
    '',
    '@',
    'ab',
    'a'.repeat(21),
    'camila_rib',
    'camila rib',
    'câmila',
    `@${'a'.repeat(64)}`,
  ])('recusa %j', (value) => {
    expect(fieldOf(() => parseCurrentUsername(value))).toEqual({
      reason: 'invalid-request',
      field: 'username',
    });
  });
});

describe('a página do hideFanComments', () => {
  it('o fã, os comentários e os posts de uma página cheia cabem nos alvos da auditoria', () => {
    const postIds = Array.from({ length: HIDE_FAN_COMMENTS_PAGE }, (_, index) => `post${index}`);
    const commentIds = Array.from({ length: HIDE_FAN_COMMENTS_PAGE }, (_, index) => `c${index}`);
    const { section, targets } = auditIndex({
      action: 'fan.comments.hidden',
      targetUid: 'uid-fa',
      details: { uid: 'uid-fa', count: HIDE_FAN_COMMENTS_PAGE, postIds, commentIds },
    });
    expect(section).toBe('moderation');
    expect(1 + 2 * HIDE_FAN_COMMENTS_PAGE).toBeLessThanOrEqual(AUDIT_TARGETS_MAX);
    expect(targets).toEqual([
      'fan:uid-fa',
      ...postIds.map((id) => `post:${id}`),
      ...commentIds.map((id) => `comment:${id}`),
    ]);
  });
});
