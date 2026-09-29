import { AccessibilityInfo } from 'react-native';

/** O que o react-hook-form entrega no envio inválido (`FieldErrors`), só com a mensagem. */
export type FormErrors<Field extends string> = Partial<Record<Field, { message?: unknown }>>;

/** A mensagem do primeiro campo com erro, na ordem em que os campos aparecem na tela. */
export function firstErrorMessage<Field extends string>(
  errors: FormErrors<Field>,
  order: readonly Field[],
): string | null {
  for (const field of order) {
    const message = errors[field]?.message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return null;
}

/**
 * Envio inválido: o leitor de tela ouve o erro do primeiro campo. O foco vai
 * para esse campo (o `ref` do `Controller`), e o erro chega ao leitor pelo
 * próprio campo, mas nada é dito quando o campo já estava com o foco (o fã
 * apertou "ir" na senha, que era o único erro), e no iOS o foco do VoiceOver
 * nem sempre segue o do teclado. Sem live region no iOS, o anúncio é o caminho.
 */
export function announceFirstError<Field extends string>(
  errors: FormErrors<Field>,
  order: readonly Field[],
): void {
  const message = firstErrorMessage(errors, order);
  if (message) AccessibilityInfo.announceForAccessibility(message);
}
