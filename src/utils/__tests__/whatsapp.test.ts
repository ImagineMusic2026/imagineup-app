import {
  BRAZIL_DDDS,
  isWhatsapp,
  maskWhatsapp,
  parseWhatsapp,
  whatsappFieldValue,
} from '../whatsapp';

// O WhatsApp do fã (seção 35). A tabela do `parseWhatsapp` é a mesma do
// servidor (`functions/src/fan-contact/model.test.ts`): mudou uma, mude a outra.

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

  it('isWhatsapp só aceita o formato guardado', () => {
    expect(isWhatsapp('+5575991234567')).toBe(true);
    expect(isWhatsapp('75991234567')).toBe(false);
    expect(isWhatsapp('+5520991234567')).toBe(false);
    expect(isWhatsapp('+557532214567')).toBe(false);
    expect(isWhatsapp(null)).toBe(false);
  });
});

describe('maskWhatsapp', () => {
  it.each([
    ['', ''],
    ['7', '(7'],
    ['75', '(75'],
    ['759', '(75) 9'],
    ['75991', '(75) 991'],
    ['7599123', '(75) 99123'],
    ['75991234', '(75) 99123-4'],
    ['75991234567', '(75) 99123-4567'],
    // Os dígitos a mais ficam de fora.
    ['759912345678', '(75) 99123-4567'],
    ['(75) 99123-45678', '(75) 99123-4567'],
    // Com o DDD 55, o dígito a mais no campo cheio também só é cortado.
    ['(55) 99123-45678', '(55) 99123-4567'],
    ['(55) 99123-456789', '(55) 99123-4567'],
    // O zero digitado antes do DDD sai.
    ['0', ''],
    ['07', '(7'],
  ])('enquanto o fã digita, %j vira %j', (raw, expected) => {
    expect(maskWhatsapp(raw)).toBe(expected);
  });

  it('o número colado com o país ou com o zero do DDD perde o prefixo', () => {
    expect(maskWhatsapp('+55 (75) 99123-4567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('5575991234567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('075991234567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('(075) 99123-4567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('55 75 99123-4567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('+55 075 99123-4567')).toBe('(75) 99123-4567');
    expect(maskWhatsapp('+55 (55) 99123-4567')).toBe('(55) 99123-4567');
    // O DDD 55 com 11 dígitos continua sendo o DDD.
    expect(maskWhatsapp('55991234567')).toBe('(55) 99123-4567');
  });

  it('apagar do fim nunca para num separador: ele sai junto com o dígito', () => {
    expect(maskWhatsapp('(75) 99123-')).toBe('(75) 99123');
    expect(maskWhatsapp('(75) ')).toBe('(75');
    expect(maskWhatsapp('(')).toBe('');
    // O separador apagado no meio volta: a máscara sai só dos dígitos.
    expect(maskWhatsapp('(75) 991234')).toBe('(75) 99123-4');
  });

  it('a máscara pronta passa no parseWhatsapp', () => {
    expect(parseWhatsapp(maskWhatsapp('75991234567'))).toBe('+5575991234567');
  });
});

describe('whatsappFieldValue', () => {
  it('o número guardado no formato do campo; sem número ou estranho, vazio', () => {
    expect(whatsappFieldValue('+5575991234567')).toBe('(75) 99123-4567');
    expect(whatsappFieldValue(null)).toBe('');
    expect(whatsappFieldValue(undefined)).toBe('');
    expect(whatsappFieldValue('(75) 99123-4567')).toBe('');
  });
});
