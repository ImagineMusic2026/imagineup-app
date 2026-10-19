/**
 * O WhatsApp do fã (docs/arquitetura-api.md, seção 35): a máscara do campo da
 * confirmação do resgate e a conferência do número. A conferência é a mesma
 * do servidor (`functions/src/fan-contact/model.ts`), com a mesma tabela de
 * testes: mudou uma, mude a outra. O número guardado é o celular brasileiro
 * em E.164 (`+5575991234567`); o campo mostra só o nacional, com o `+55` fixo
 * na frente ("(75) 99123-4567").
 */

/** Os DDDs do Brasil (o plano de numeração da Anatel): 67 códigos. */
export const BRAZIL_DDDS: ReadonlySet<string> = new Set([
  ...['11', '12', '13', '14', '15', '16', '17', '18', '19'],
  ...['21', '22', '24', '27', '28'],
  ...['31', '32', '33', '34', '35', '37', '38'],
  ...['41', '42', '43', '44', '45', '46', '47', '48', '49'],
  ...['51', '53', '54', '55'],
  ...['61', '62', '63', '64', '65', '66', '67', '68', '69'],
  ...['71', '73', '74', '75', '77', '79'],
  ...['81', '82', '83', '84', '85', '86', '87', '88', '89'],
  ...['91', '92', '93', '94', '95', '96', '97', '98', '99'],
]);

/** O que o servidor aceita: até 40 caracteres (a máscara usa 15). */
export const WHATSAPP_INPUT_MAX = 40;

/** Dígitos, espaço, parênteses, hífen, ponto e o `+` só no começo. */
const WHATSAPP_INPUT = /^\+?[\d\s().-]+$/;

/** O número guardado: `+55`, o DDD e o celular de 9 dígitos começando por 9. */
const STORED_WHATSAPP = /^\+55(\d{2})9\d{8}$/;

/** O celular com DDD, só os 11 dígitos: o E.164, ou `null` com outro DDD ou sem o 9. */
function nationalMobile(digits: string): string | null {
  if (!/^\d{11}$/.test(digits)) return null;
  if (!BRAZIL_DDDS.has(digits.slice(0, 2)) || digits[2] !== '9') return null;
  return `+55${digits}`;
}

/**
 * O número no formato guardado, ou `null` fora do formato: aceita a máscara
 * ("(75) 99123-4567"), o número com o país ("+55 75 99123-4567") e o zero do
 * DDD ("075 99123-4567"); recusa o fixo, o celular sem o 9, o DDD que não
 * existe, outro país e letras.
 */
export function parseWhatsapp(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > WHATSAPP_INPUT_MAX) return null;
  const text = raw.trim();
  if (!WHATSAPP_INPUT.test(text)) return null;
  const digits = text.replace(/\D/g, '');
  if (text.startsWith('+')) return digits.startsWith('55') ? nationalMobile(digits.slice(2)) : null;
  if (digits.length === 13 && digits.startsWith('55')) return nationalMobile(digits.slice(2));
  if (digits.length === 12 && digits.startsWith('0')) return nationalMobile(digits.slice(1));
  return nationalMobile(digits);
}

/** O valor está no formato guardado (o que a API devolve passa por aqui de novo). */
export function isWhatsapp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = STORED_WHATSAPP.exec(value);
  return match !== null && BRAZIL_DDDS.has(match[1]!);
}

/**
 * Os dígitos do número nacional que o fã digitou ou colou, até 11. O campo já
 * mascarado (começa com o parêntese) nunca perde o `55`: com o DDD 55 (RS), um
 * dígito a mais no fim é cortado, e não lido como o código do país. Só o
 * número colado cru perde o país: com o `+`, ou com 12 ou mais dígitos
 * começando por 55. O zero do DDD sai sempre (nenhum DDD começa com 0).
 */
function nationalDigits(raw: string): string {
  const text = raw.trim();
  let digits = text.replace(/\D/g, '');
  const pasted = !text.startsWith('(');
  if (digits.startsWith('55') && (text.startsWith('+') || (pasted && digits.length >= 12))) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 11);
}

/**
 * A máscara do campo, montada a cada mudança: "(75) 99123-4567". O
 * parêntese, o espaço e o hífen só entram com um dígito depois deles: apagar
 * o último dígito nunca deixa o fã preso num separador.
 */
export function maskWhatsapp(raw: string): string {
  const digits = nationalDigits(raw);
  if (digits.length === 0) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 5) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
}

/** O número guardado no formato do campo ("(75) 99123-4567"); sem número ou fora do formato, vazio. */
export function whatsappFieldValue(stored: string | null | undefined): string {
  return isWhatsapp(stored) ? maskWhatsapp(stored.slice(3)) : '';
}
