/**
 * As chaves do check-in diário. A chave inclui tudo que muda o resultado.
 *
 * Fica num arquivo sem dependências, no molde do `fan-club/keys.ts`: o puxar
 * para atualizar da Início e o do perfil invalidam o estado pela chave, sem
 * criar a consulta nem puxar a API.
 */
export const checkinKeys = {
  all: ['checkin'] as const,
  /** O estado do fã (`GET /me/checkin`): o card da Início e a pílula da 1e. */
  state: () => [...checkinKeys.all, 'state'] as const,
};

/** O toque em "Fazer check-in" (`POST /me/checkin`). */
export const checkinMutationKeys = {
  checkin: ['checkin', 'do'] as const,
};
