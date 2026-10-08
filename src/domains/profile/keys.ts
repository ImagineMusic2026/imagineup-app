/**
 * A chave inclui tudo que muda o resultado. Fica num arquivo sem API (e sem
 * Firebase): o domínio `artists` invalida a carteira depois de entrar numa
 * central e importa daqui direto, porque pelo index seria um ciclo (o perfil
 * lê as centrais de lá).
 */
export const profileKeys = {
  all: ['profile'] as const,
  me: (uid: string) => [...profileKeys.all, 'me', uid] as const,
  wallet: () => [...profileKeys.all, 'wallet'] as const,
  /**
   * Nível e ganhos da semana saem do mesmo XP da carteira. A chave fica debaixo
   * da dela: quem invalida a carteira depois de um ganho (o "Eu vou" da agenda)
   * ou de um resgate invalida o progresso junto, e o anel nunca fica com o
   * nível de antes.
   */
  progress: () => [...profileKeys.wallet(), 'progress'] as const,
  achievements: () => [...profileKeys.all, 'achievements'] as const,
  /**
   * O extrato (bloco 7), debaixo da carteira: quem invalida a carteira depois
   * de ganhar ou gastar pontos invalida o extrato junto.
   */
  ledger: () => [...profileKeys.wallet(), 'ledger'] as const,
  invite: () => [...profileKeys.all, 'invite'] as const,
  /** O @ que o fã digita na tela "Editar perfil" (bloco 9). */
  username: () => [...profileKeys.all, 'username'] as const,
  usernameAvailability: (username: string) =>
    [...profileKeys.username(), 'availability', username] as const,
};

/**
 * O perfil público de outro fã (`GET /fans/:fanId`, seção 28), fora do
 * `profileKeys`: invalidar o perfil do próprio fã (a carteira, o nível) não
 * busca de novo o perfil de quem ele abriu, e o ✓ invalida só o dele aqui.
 */
export const fanKeys = {
  all: ['fan'] as const,
  profile: (fanId: string) => [...fanKeys.all, 'profile', fanId] as const,
};

/**
 * As mutações da tela "Editar perfil" (bloco 9 e seção 28), lidas pelo
 * `useIsMutating`: a gravação pendente vale também com a tela fechada e aberta
 * de novo. O `update` é o ✓ (`PUT /me/profile`, com o @ junto); a foto salva
 * na hora, fora dele.
 */
export const profileMutationKeys = {
  update: ['profile', 'update'] as const,
  photo: ['profile', 'photo', 'set'] as const,
  removePhoto: ['profile', 'photo', 'remove'] as const,
};
