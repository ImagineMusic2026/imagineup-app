import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/** O navegador de abas em volta da pilha, visto só pelo evento que importa aqui. */
interface TabPressSource {
  addListener: (
    type: 'tabPress',
    listener: (event: { preventDefault: () => void }) => void,
  ) => () => void;
}

/**
 * Prende o fã na tela enquanto `locked`: o voltar do Android não faz nada, o
 * gesto de voltar do iOS fica desligado e, dentro das abas, tocar de novo na
 * aba não volta a pilha ao topo (o que desmontaria a tela no meio da ação). Os
 * controles da própria tela (voltar, rodapé) a tela desativa. No cadastro,
 * sair no meio deixaria a espera do perfil sem tela, e um segundo cadastro com
 * o mesmo e-mail daria "Esse e-mail já tem conta" para quem acabou de criá-la;
 * na exclusão da conta, o pedido de senha sumiria com a tela.
 */
export function useStayOnScreen(locked: boolean): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !locked });
    if (!locked) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    // Fora das abas, o pai não emite `tabPress` e a escuta não faz nada.
    const stopTabPress = navigation
      .getParent<TabPressSource | undefined>()
      ?.addListener('tabPress', (event) => event.preventDefault());
    return () => {
      subscription.remove();
      stopTabPress?.();
    };
  }, [locked, navigation]);
}
