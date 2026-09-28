import { onlineManager } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

import { t } from '@/i18n';

/**
 * Avisa o leitor de tela quando a conexão cai (WCAG 4.1.3). Fica num lugar só:
 * cada tela montada tem um OfflineBanner, e anunciar por ele repetiria o aviso.
 * Papel "alert" e live region não resolvem, porque o iOS não tem nenhum dos dois.
 */
export function useAnnounceOffline(): void {
  useEffect(() => {
    let wasOnline = onlineManager.isOnline();
    return onlineManager.subscribe((isOnline) => {
      if (wasOnline && !isOnline) AccessibilityInfo.announceForAccessibility(t('offline.banner'));
      wasOnline = isOnline;
    });
  }, []);
}
