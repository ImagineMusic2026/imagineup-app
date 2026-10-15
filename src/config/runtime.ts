import { isRunningInExpoGo } from 'expo';

/**
 * Onde o app roda (seção 33 de docs/arquitetura-api.md, decisão 16). Mora à
 * parte por causa do Jest: o jest-expo traz o módulo nativo `ExpoGo` falso, e
 * com ele o `isRunningInExpoGo()` do `expo` dá verdadeiro em toda suíte. O
 * `jest.setup.js` troca este módulo por um com o `isExpoGo` falso, sem mockar
 * o `expo` inteiro; teste do Expo Go muda o retorno no próprio arquivo.
 */

/**
 * O app roda dentro do Expo Go, e não numa build própria (o APK de
 * desenvolvimento, o preview ou a loja). No Expo Go só existem os módulos
 * nativos dele: o pacote do Google, por exemplo, derruba o app no import.
 */
export function isExpoGo(): boolean {
  return isRunningInExpoGo();
}
