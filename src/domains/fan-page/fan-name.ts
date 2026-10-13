import type { FanPublicProfile } from '@/domains/profile';
import { t } from '@/i18n';

/**
 * O nome do fã nas frases do bloco "Segurança" e da sheet de denúncia (seção
 * 29, 29.11): o nome; sem ele, o @; sem os dois, "este fã".
 */
export function fanNameOf(profile: Pick<FanPublicProfile, 'displayName' | 'username'>): string {
  if (profile.displayName) return profile.displayName;
  if (profile.username) return `@${profile.username}`;
  return t('fanPage.thisFan');
}
