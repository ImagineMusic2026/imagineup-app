import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect } from 'react';
import { BackHandler } from 'react-native';

/**
 * Prende o fã na tela enquanto `locked`: o voltar do Android não faz nada e o
 * gesto de voltar do iOS fica desligado. Os controles da própria tela (voltar,
 * rodapé) a tela desativa. No cadastro, sair no meio deixaria a espera do
 * perfil sem tela, e um segundo cadastro com o mesmo e-mail daria "Esse e-mail
 * já tem conta" para quem acabou de criá-la.
 */
export function useStayOnScreen(locked: boolean): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !locked });
    if (!locked) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [locked, navigation]);
}
