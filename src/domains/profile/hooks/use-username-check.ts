import { useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { t, type TranslationKey } from '@/i18n';

import { USERNAME_CHECK_DEBOUNCE_MS } from '../consts';
import { useUsernameAvailabilityQuery } from '../queries';
import type { UsernameStatus } from '../types';
import { isUsernameFormat, normalizeUsername } from '../username';

/**
 * O status do @ que o fã digitou: o do servidor (`UsernameStatus`), o
 * "Conferindo..." ou `unchecked` (a consulta falhou: rede, 5xx).
 */
export type UsernameCheckStatus = UsernameStatus | 'checking' | 'unchecked';

/** O texto de cada status do @ mexido, na linha embaixo do card e na dica do campo. */
export const USERNAME_STATUS_TEXT: Readonly<
  Record<Exclude<UsernameCheckStatus, 'current'>, TranslationKey>
> = {
  checking: 'editProfile.username.checking',
  available: 'editProfile.username.available',
  taken: 'editProfile.username.taken',
  reserved: 'editProfile.username.reserved',
  invalid: 'editProfile.username.invalid',
  unchecked: 'editProfile.username.checkError',
};

/** Os status que seguram o @ como erro (o X em `danger`). */
export const USERNAME_ERROR_STATUSES: ReadonlySet<UsernameCheckStatus> = new Set([
  'taken',
  'reserved',
  'invalid',
  'unchecked',
]);

export interface UsernameCheck {
  /** O @ do campo, normalizado. */
  normalized: string;
  /** O @ do campo difere do de agora. */
  changed: boolean;
  /** `null` com o @ de agora (ou sem a conferência ligada). */
  status: UsernameCheckStatus | null;
  /** O @ mexido pode ir no corpo do ✓ ("Disponível"). */
  sendable: boolean;
  /** O @ mexido ainda não está "Disponível": o ✓ segura. */
  blocking: boolean;
  /** Confere de novo (o "Tentar de novo" da consulta que falhou), anunciando outra vez. */
  recheck: () => void;
  /** O status deste @ já foi dito por quem chama (a recusa do ✓): não anuncia de novo. */
  markAnnounced: (username: string, status: UsernameCheckStatus) => void;
}

/**
 * A conferência do @ da tela "Editar perfil" (bloco 9, seção 28): normaliza o
 * que o fã digita e, 400 ms depois da última tecla, pergunta ao servidor se o
 * @ está livre (fora do formato, sem perguntar). O status final é anunciado
 * uma vez por @ (o "Conferindo..." não). Desligada (`enabled` falso: sem a API,
 * com o prazo do @ correndo, o fã suspenso), não pergunta nada e o @ não muda.
 */
export function useUsernameCheck({
  draft,
  current,
  enabled,
}: {
  draft: string;
  current: string;
  enabled: boolean;
}): UsernameCheck {
  const normalized = normalizeUsername(draft);
  const debounced = useDebouncedValue(normalized, USERNAME_CHECK_DEBOUNCE_MS);
  const settled = debounced === normalized;
  const changed = enabled && normalized !== current;
  const formatOk = isUsernameFormat(normalized);
  const availability = useUsernameAvailabilityQuery(debounced, changed && settled && formatOk);

  let status: UsernameCheckStatus | null = null;
  if (changed) {
    if (!settled) status = 'checking';
    else if (!formatOk) status = 'invalid';
    else if (availability.data?.username === normalized) status = availability.data.status;
    else if (availability.isError && !availability.isFetching) status = 'unchecked';
    else status = 'checking';
  }

  // O status final, uma vez por @ (o "Conferindo..." e o @ de agora não).
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (!status || status === 'checking' || status === 'current') return;
    const key = `${normalized}:${status}`;
    if (announced.current === key) return;
    announced.current = key;
    AccessibilityInfo.announceForAccessibility(t(USERNAME_STATUS_TEXT[status]));
  }, [status, normalized]);

  return {
    normalized,
    changed,
    status,
    sendable: changed && status === 'available',
    blocking: changed && status !== 'available' && status !== 'current',
    recheck: () => {
      announced.current = null;
      void availability.refetch();
    },
    markAnnounced: (username, refused) => {
      announced.current = `${username}:${refused}`;
    },
  };
}
