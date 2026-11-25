import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * O leitor de tela (TalkBack ou VoiceOver) ligado, atualizado se o fã ligar ou
 * desligar com o app aberto. Começa desligado até o sistema responder.
 */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((value) => {
        if (mounted) setEnabled(value);
      })
      .catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', setEnabled);
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return enabled;
}
