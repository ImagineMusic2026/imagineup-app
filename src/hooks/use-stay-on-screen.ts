import { useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';

/** O navegador de abas em volta da pilha, visto só pelo evento que importa aqui. */
interface TabPressSource {
  addListener: (
    type: 'tabPress',
    listener: (event: { preventDefault: () => void }) => void,
  ) => () => void;
}

/**
 * - `free`: a tela sai como qualquer outra;
 * - `confirm`: sair pergunta antes (o "Descartar alterações?" da tela "Editar
 *   perfil"): o voltar do Android chama o `onAsk`, e o gesto de voltar do iOS
 *   fica desligado (ele não deixa perguntar);
 * - `locked`: a tela fica presa enquanto uma ação não pode ser deixada no meio.
 */
export type StayOnScreenMode = 'free' | 'confirm' | 'locked';

/**
 * Segura o fã na tela. Fora de `free`, o gesto de voltar do iOS fica
 * desligado. No voltar do Android, `confirm` chama o `onAsk` (a tela pergunta
 * e decide se sai) e `locked` não faz nada. Só no `locked`, dentro das abas,
 * tocar de novo na aba não volta a pilha ao topo (o que desmontaria a tela no
 * meio da ação). Os controles da própria tela (voltar, rodapé) a tela
 * desativa ou faz perguntar.
 *
 * O booleano de antes continua valendo: `true` é `locked` e `false` é `free`.
 * No cadastro, sair no meio deixaria a espera do perfil sem tela, e um segundo
 * cadastro com o mesmo e-mail daria "Esse e-mail já tem conta" para quem
 * acabou de criá-la; na exclusão da conta, o pedido de senha sumiria com a
 * tela.
 *
 * Um hook só para os dois usos: dois efeitos com `setOptions({ gestureEnabled })`
 * se desfariam. O `onAsk` é lido por ref, para o efeito não refazer a cada render.
 */
export function useStayOnScreen(mode: StayOnScreenMode | boolean, onAsk?: () => void): void {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const resolved: StayOnScreenMode = mode === true ? 'locked' : mode === false ? 'free' : mode;
  const ask = useRef(onAsk);

  useEffect(() => {
    ask.current = onAsk;
  }, [onAsk]);

  useEffect(() => {
    navigation.setOptions({ gestureEnabled: resolved === 'free' });
    if (resolved === 'free') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (resolved === 'confirm') ask.current?.();
      // `true` diz ao Android que o voltar já foi tratado: a tela fica (ou a pergunta decide).
      return true;
    });
    // Fora das abas, o pai não emite `tabPress` e a escuta não faz nada.
    const stopTabPress =
      resolved === 'locked'
        ? navigation
            .getParent<TabPressSource | undefined>()
            ?.addListener('tabPress', (event) => event.preventDefault())
        : undefined;
    return () => {
      subscription.remove();
      stopTabPress?.();
    };
  }, [resolved, navigation]);
}
