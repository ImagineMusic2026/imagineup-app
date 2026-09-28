import { inviteRoute, parseInviteLink } from '@/domains/invites';

/**
 * Reescreve links de fora antes do Expo Router casar a rota. Roda fora do React
 * e não pode lançar: link curto de convite (`/c/ABC`) ou link com `?ref=` vira
 * `/convite/ABC`, que guarda o código; o resto passa como veio.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const invite = parseInviteLink(path);
    return invite ? inviteRoute(invite) : path;
  } catch {
    return path;
  }
}
