import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

/**
 * Montado, mas fora da vista: sem toque e fora do leitor de tela. São as props
 * da caixa que guarda o que sai de cena sem sair da árvore: o campo de outra
 * pergunta (`StepField`) e a pergunta inteira embaixo do momento do cadastro.
 */
export function offstage(hidden: boolean) {
  return {
    pointerEvents: hidden ? 'none' : 'auto',
    accessible: false,
    accessibilityElementsHidden: hidden,
    importantForAccessibility: hidden ? 'no-hide-descendants' : 'auto',
  } as const;
}

export interface StepFieldProps {
  /** A pergunta deste campo é a que está à vista. */
  shown: boolean;
  /** O campo e o que vai junto dele (o medidor, os termos, o link da senha). */
  children: ReactNode;
}

/**
 * O campo de uma pergunta da entrada (cadastro e entrar com e-mail) e o que vai
 * junto dele. Os campos de todas as perguntas da tela ficam montados o tempo
 * todo, e só o da pergunta à vista aparece: assim, trocar de pergunta leva o
 * foco direto de um campo ao outro, e o teclado segue aberto. Com um campo
 * saindo da árvore para o outro entrar, o que sai com o foco manda fechar o
 * teclado (o `blur` do React Native ao desmontar) e o que entra manda abrir de
 * novo: o pé, preso acima do teclado, cairia e subiria a cada pergunta.
 *
 * Fora da pergunta dele, o campo fica guardado: fora do fluxo, do toque e do
 * leitor de tela, e sem desenho. Opacidade zero, e não `display: 'none'`: no
 * Android, o campo que fica invisível de verdade perde o foco na hora, antes
 * de o seguinte recebê-lo, e o teclado fecharia do mesmo jeito. O que foi
 * digitado continua nele e no formulário, e ele segue na árvore com as marcas
 * do preenchimento automático (e-mail e senha na mesma tela). Se o gerenciador
 * de senhas do aparelho enxerga o campo guardado, só o aparelho responde: por
 * isso o envio confere de novo o que estava fora da vista.
 *
 * A caixa existe de verdade nos dois estados (`collapsable={false}`). Só
 * guardada ela teria por que existir (a opacidade, o toque): à vista, sem
 * estilo nenhum, o React Native a achataria. Com a caixa indo e vindo, o
 * campo seria tirado de um pai e posto no outro a cada troca de pergunta, e o
 * que está com o foco o perderia ali, fechando o teclado do mesmo jeito.
 *
 * Os campos de uma tela vão juntos numa `View`: o guardado fica por cima do
 * lugar do que está à vista, com a largura dele.
 */
export function StepField({ shown, children }: StepFieldProps) {
  return (
    <View collapsable={false} {...offstage(!shown)} style={shown ? undefined : styles.stored}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  // O campo guardado: fora do fluxo, por cima do lugar do campo à vista, sem desenho.
  stored: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    opacity: 0,
  },
});
