import type { SupportKind } from './types';

/** O texto, de 1 a 2.000 caracteres, como no servidor (`SUPPORT_TEXT_MAX`, 38.2). */
export const SUPPORT_TEXT_MAX = 2_000;

/** Os três tipos, na ordem da seção Suporte dos Ajustes. */
export const SUPPORT_KINDS: readonly SupportKind[] = ['problem', 'idea', 'feedback'];

/**
 * O pedaço da rota de cada tipo (`/suporte/problema`, `/suporte/sugestao` e
 * `/suporte/feedback`), em português, como os outros endereços do app.
 */
export const SUPPORT_SLUGS: Record<SupportKind, string> = {
  problem: 'problema',
  idea: 'sugestao',
  feedback: 'feedback',
};

/** O tipo de um pedaço da rota, ou `null` (o endereço digitado errado). */
export function supportKindOf(slug: unknown): SupportKind | null {
  const found = SUPPORT_KINDS.find((kind) => SUPPORT_SLUGS[kind] === slug);
  return found ?? null;
}
