import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { useSessionStore } from '@/stores/session';

import { appleDeletionMode, type AppleDeletionMode } from '../api';

/**
 * Como a exclusão da conta da sessão confirma a Apple, só no iPhone (39.4): a
 * tela escreve o botão e o aviso antes do toque. Até a resposta chegar, e sem
 * a Apple, `null` (a tela de antes). A resposta fica enquanto a sessão sai na
 * saída da exclusão, para o rótulo não trocar no último quadro.
 */
export function useAppleDeletionMode(): AppleDeletionMode {
  const uid = useSessionStore((state) => state.user?.uid ?? null);
  const [resolved, setResolved] = useState<{ uid: string; mode: AppleDeletionMode } | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'ios' || uid === null) return undefined;
    let mounted = true;
    void appleDeletionMode(uid).then((mode) => {
      if (mounted && mode !== null) setResolved({ uid, mode });
    });
    return () => {
      mounted = false;
    };
  }, [uid]);

  return resolved && (uid === null || resolved.uid === uid) ? resolved.mode : null;
}
