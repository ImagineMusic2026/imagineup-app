import { describe, expect, it } from 'vitest';

import { BRAZIL_DDDS, contactWhatsapp, isWhatsapp, parseWhatsapp } from './model';

// O contato do fã (seção 35): a conferência do número que o resgate recebe. A
// mesma tabela está no teste do app (`src/utils/__tests__/whatsapp.test.ts`):
// mudou uma, mude a outra.

describe('parseWhatsapp', () => {
  it.each([
    ['(75) 99123-4567', '+5575991234567'],
    ['75991234567', '+5575991234567'],
    ['75 99123 4567', '+5575991234567'],
    ['75.99123.4567', '+5575991234567'],
    ['+55 75 99123-4567', '+5575991234567'],
    ['+5575991234567', '+5575991234567'],
    ['55 75 99123-4567', '+5575991234567'],
    ['5575991234567', '+5575991234567'],
    ['(075) 99123-4567', '+5575991234567'],
    ['  (11) 98765-4321  ', '+5511987654321'],
    // O DDD 55 (RS) com 11 dígitos é número do Brasil, não o código do país.
    ['(55) 99123-4567', '+5555991234567'],
  ])('aceita %j como %s', (raw, expected) => {
    expect(parseWhatsapp(raw)).toBe(expected);
  });

  it.each([
    ['vazio', ''],
    ['só espaço', '   '],
    ['o fixo, 8 dígitos depois do DDD', '(75) 3221-4567'],
    ['o celular sem o 9', '(75) 9123-4567'],
    ['o 9 fora do lugar', '(75) 89123-4567'],
    ['sem o DDD', '99123-4567'],
    ['o DDD que não existe (20)', '(20) 99123-4567'],
    ['o DDD que não existe (23)', '(23) 99123-4567'],
    ['o DDD com zero', '(01) 99123-4567'],
    ['um dígito a mais', '(75) 99123-45678'],
    ['outro país', '+1 415 555 0100'],
    ['outro país com 11 dígitos', '+44 7911 123456'],
    ['o + no meio', '75 +99123-4567'],
    ['letras', '(75) 9912a-4567'],
    ['o link do WhatsApp', 'wa.me/5575991234567'],
    ['acima de 40 caracteres', `${' '.repeat(30)}(75) 99123-4567`],
  ])('recusa %s', (_name, raw) => {
    expect(parseWhatsapp(raw)).toBeNull();
  });

  it('recusa o que não é texto', () => {
    for (const value of [null, undefined, 75991234567, ['75991234567'], { whatsapp: 'x' }]) {
      expect(parseWhatsapp(value)).toBeNull();
    }
  });

  it('os 67 DDDs do Brasil', () => {
    expect(BRAZIL_DDDS.size).toBe(67);
    for (const ddd of BRAZIL_DDDS) {
      expect(parseWhatsapp(`(${ddd}) 99123-4567`)).toBe(`+55${ddd}991234567`);
    }
  });
});

describe('o número guardado', () => {
  it('isWhatsapp só aceita o formato que o parseWhatsapp devolve', () => {
    expect(isWhatsapp('+5575991234567')).toBe(true);
    expect(isWhatsapp('75991234567')).toBe(false);
    expect(isWhatsapp('+5520991234567')).toBe(false);
    expect(isWhatsapp('+557532214567')).toBe(false);
    expect(isWhatsapp('+5575991234567 ')).toBe(false);
    expect(isWhatsapp(null)).toBe(false);
  });

  it('contactWhatsapp lê o documento, e o estranho, o apagado e o ausente valem null', () => {
    expect(contactWhatsapp({ whatsapp: '+5575991234567', source: 'store' })).toBe('+5575991234567');
    expect(contactWhatsapp({ whatsapp: null, source: 'app' })).toBeNull();
    expect(contactWhatsapp({ whatsapp: '(75) 99123-4567' })).toBeNull();
    expect(contactWhatsapp({})).toBeNull();
    expect(contactWhatsapp(undefined)).toBeNull();
  });
});
