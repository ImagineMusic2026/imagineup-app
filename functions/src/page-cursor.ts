// Cursor das listas do mural, dos comentários e da agenda (bloco 6): texto
// opaco para o app, o base64url de `[instanteEmMs, id]`, como o do extrato
// (seção 6). O instante desempata pela ordem da lista (`publishedAt` nos
// posts, `createdAt` nos comentários, `startsAt` na agenda) e o id do
// documento desempata o mesmo milissegundo. docs/arquitetura-api.md, 21.2.

export type PageCursor = { at: number; id: string };

/**
 * O maior instante que o Timestamp do Firestore aceita: acima dele, o
 * `Timestamp.fromMillis` do `startAfter` lança, e o cursor montado à mão
 * viraria 500 em vez de 400.
 */
const MAX_TIMESTAMP_MS = 253_402_300_799_999;

/** Id de post, de comentário e de show: o do `doc()` do Firestore e os do seed. */
export const CONTENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** Id no formato e fora dos ids `__.*__`, que o Firestore reserva. */
export function isContentId(value: unknown): value is string {
  return typeof value === 'string' && CONTENT_ID_PATTERN.test(value) && !/^__.*__$/.test(value);
}

export function encodePageCursor(cursor: PageCursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.id]), 'utf8').toString('base64url');
}

/** null quando o texto não é um cursor nosso (400 na rota). */
export function decodePageCursor(value: string): PageCursor | null {
  if (!/^[A-Za-z0-9_-]{1,600}$/.test(value)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      Number.isInteger(parsed[0]) &&
      parsed[0] >= 0 &&
      parsed[0] <= MAX_TIMESTAMP_MS &&
      isContentId(parsed[1])
    ) {
      return { at: parsed[0], id: parsed[1] };
    }
  } catch {
    return null;
  }
  return null;
}
