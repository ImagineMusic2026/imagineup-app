import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect } from 'react';
import type { TextInput as NativeTextInput } from 'react-native';

/**
 * O teclado já aberto quando a tela chega: no Android, o `autoFocus` de um
 * campo que monta durante a animação da pilha foca antes de a janela estar
 * pronta, e o teclado não sobe (conferido no emulador em 04/11/2026). O foco
 * vai de novo ao campo quando a entrada da tela termina; no iOS, e com o
 * reduzir movimento, o `autoFocus` já resolveu, e focar de novo não muda nada.
 *
 * Para as telas que abrem com o teclado: o campo grande do Suporte e o
 * primeiro campo das perguntas da entrada (cadastro e entrar com e-mail). O
 * `input` é o ref do campo, lido só quando a transição termina: o campo pode
 * montar depois da tela.
 */
export function useFocusAfterTransition(input: { current: NativeTextInput | null }): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  useEffect(
    () =>
      navigation.addListener('transitionEnd', (event) => {
        if (!event.data.closing) input.current?.focus();
      }),
    [navigation, input],
  );
}
