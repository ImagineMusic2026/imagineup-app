// O contato do fã (docs/arquitetura-api.md, seção 35, e a decisão 14 da
// seção 34): o WhatsApp que a equipe usa para combinar a entrega dos resgates
// da loja e, com o fã-clube, dos prêmios. Um número por fã, num lugar privado
// (`users/{uid}/contact/main`, fechado nas regras), guardado como celular
// brasileiro em E.164 (`+55`, o DDD e os 9 dígitos). Puro: nada aqui lê o
// Firestore. O app tem a mesma conferência em `src/utils/whatsapp.ts`: mudou
// uma, mude a outra.

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

/** O que o fã pode mandar: até 40 caracteres (a máscara do app usa 15). */
export const WHATSAPP_INPUT_MAX = 40;

/** Dígitos, espaço, parênteses, hífen, ponto e o `+` só no começo. */
const WHATSAPP_INPUT = /^\+?[\d\s().-]+$/;

/** O número guardado: `+55`, o DDD e o celular de 9 dígitos começando por 9. */
const STORED_WHATSAPP = /^\+55(\d{2})9\d{8}$/;

/**
 * O celular de um DDD brasileiro, só os 11 dígitos (o DDD e o número com o
 * 9): devolve o E.164, ou `null` com outro DDD ou sem o 9.
 */
function nationalMobile(digits: string): string | null {
  if (!/^\d{11}$/.test(digits)) return null;
  if (!BRAZIL_DDDS.has(digits.slice(0, 2)) || digits[2] !== '9') return null;
  return `+55${digits}`;
}

/**
 * O WhatsApp que o fã digitou, no formato guardado (`+5575991234567`), ou
 * `null` fora do formato. Aceita a máscara do app ("(75) 99123-4567"), o
 * número colado com o país ("+55 75 99123-4567", "55 75 99123-4567") e o zero
 * do DDD ("075 99123-4567"). Recusa o fixo (8 dígitos depois do DDD), o
 * celular sem o 9, o DDD que não existe, o número de outro país, letras e o
 * texto acima de 40 caracteres. Sem leitura: o `validate` da rota chama.
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

/** O valor guardado está no formato (quem lê confere de novo: o que não passa vale `null`). */
export function isWhatsapp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = STORED_WHATSAPP.exec(value);
  return match !== null && BRAZIL_DDDS.has(match[1]!);
}

/** Onde o número foi gravado pela última vez (34.4): o resgate, a candidatura ou a edição. */
export type ContactSource = 'store' | 'fanclub' | 'app';

/** `users/{uid}/contact/main` lido: o número no formato, ou `null` (sem o documento, apagado ou estranho). */
export function contactWhatsapp(data: Record<string, unknown> | undefined): string | null {
  const value = data?.whatsapp;
  return isWhatsapp(value) ? value : null;
}
