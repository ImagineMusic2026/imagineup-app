import { router } from 'expo-router';

import { resetEmailSchema } from './schemas';

// O que as telas de perguntas da entrada (cadastro e entrar com e-mail)
// dividem fora do desenho. A casca é o `QuestionLayout`, o pé é o `StepFooter`
// e o campo de cada pergunta vai num `StepField`.

/**
 * O voltar da primeira pergunta sai da tela. Sem para onde voltar (a tela
 * aberta a frio), vai para a abertura: o início (`/`) fica barrado pelo guard
 * para quem está fora.
 */
export function backToWelcome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/entrar');
}

/**
 * O e-mail como ele vai para o Firebase: sem os espaços das pontas e em
 * minúsculas, pelo mesmo campo do formulário do entrar e do cadastro. É o que
 * a pílula mostra na pergunta da senha. Fora do formato (o campo guardado que
 * mudou fora da vista), sai como foi digitado, só sem os espaços das pontas:
 * quem recusa é a conferência do envio.
 */
export function normalizedEmail(typed: string): string {
  const parsed = resetEmailSchema.safeParse(typed);
  return parsed.success ? parsed.data : typed.trim();
}
