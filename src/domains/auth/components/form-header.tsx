import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { BackButton } from '@/components/header';
import { StepProgress } from '@/components/step-progress';
import { layout, spacing } from '@/theme';

export interface FormHeaderProps {
  /** Barra de etapas do cadastro. Sem ela, o espaço fica vazio e o título cai no mesmo lugar. */
  step?: { current: number; total: number };
  /** Voltar desativado enquanto a conta está sendo criada. */
  locked?: boolean;
}

/**
 * Sem para onde voltar (formulário aberto a frio), vai para a abertura: o
 * início (`/`) fica barrado pelo guard para quem está fora.
 */
function backToWelcome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/entrar');
}

/**
 * Topo das telas de conta (entrar com e-mail, cadastro): o voltar alinhado ao
 * logo do fundo e, no cadastro, a barra de etapas. As duas telas reservam a
 * mesma altura, para o título não pular na troca em fade entre elas.
 */
export function FormHeader({ step, locked = false }: FormHeaderProps) {
  return (
    <View>
      <View style={styles.backRow}>
        <BackButton onPress={backToWelcome} disabled={locked} />
      </View>
      <View style={styles.stepArea}>
        {step ? <StepProgress current={step.current} total={step.total} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // O voltar fica a 18 da borda; o resto do formulário, a 22.
  backRow: {
    marginHorizontal: spacing.gutter - spacing.gutterOnboarding,
  },
  // Etapas a 18 do alvo do voltar e a 22 do título (y 124 e 149 no frame).
  stepArea: {
    height: layout.stepBar,
    marginTop: spacing.blockGap,
    marginBottom: spacing.gutterOnboarding,
  },
});
