import type { Href } from 'expo-router';

/**
 * O endereço do perfil público de outro fã (`/fa/<uid>`, seção 28), na pilha
 * raiz: de dentro das abas, o push empilha por cima delas, e o voltar devolve
 * à aba; do post, empilha sobre o post. O parâmetro é o `fanId` da API
 * (`/fans/:fanId`).
 */
export function fanProfileHref(fanId: string): Href {
  return { pathname: '/fa/[fanId]', params: { fanId } };
}
