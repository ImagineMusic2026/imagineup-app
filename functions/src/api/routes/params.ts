import { isFanId } from '../../moderation';
import { apiError } from '../errors';
import type { RouteInput } from '../types';

// Validadores de parâmetro do caminho divididos entre as rotas.

/**
 * O `:fanId` (o uid de um fã: letras e números, até 128). Fora do formato,
 * 404 `fan_not_found` sem ler nada: o bloqueio (bloco 6) e o perfil público
 * (seção 28) usam.
 */
export function fanParam(input: RouteInput): void {
  if (!isFanId(input.params.fanId)) throw apiError('fan_not_found');
}
