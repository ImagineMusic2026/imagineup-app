import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

const isIOS = Platform.OS === 'ios';

function heightOf(event: KeyboardEvent): number {
  return Math.max(0, event.endCoordinates.height);
}

/**
 * O teclado está aberto cobrindo o pé da tela? No iOS acompanha o começo da
 * animação dele ("will"); o Android só avisa quando ela termina ("did"). Aviso
 * com altura zero conta como fechado. Serve para o que fica preso embaixo da
 * tela (o campo de comentário) trocar a área segura de baixo, que o teclado
 * cobre, por uma margem pequena. O teclado flutuante do Android (o do
 * emulador com teclado físico) não cobre o pé: avisa altura zero (a do
 * teclado menos a da barra de navegação, que o React Native tira) e o topo
 * dele acima da barra. Quem usa o `KeyboardAvoidingView` o desliga nesse caso
 * (a tela do post), senão ele sobe o conteúdo a altura da barra.
 */
export function useKeyboardVisible(): boolean {
  const [height, setHeight] = useState(() => Keyboard.metrics()?.height ?? 0);

  useEffect(() => {
    const show = Keyboard.addListener(isIOS ? 'keyboardWillShow' : 'keyboardDidShow', (event) =>
      setHeight(heightOf(event)),
    );
    const hide = Keyboard.addListener(isIOS ? 'keyboardWillHide' : 'keyboardDidHide', () =>
      setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height > 0;
}
