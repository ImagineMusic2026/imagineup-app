import { sourceOf } from '@/config/data-source';
import { firebaseEmulatorHost } from '@/config/server';
import { t } from '@/i18n';

import { SOCIAL_PREFIX } from './components/profile-read-only';
import { SOCIAL_NETWORKS, socialUrl } from './details';
import { SOCIAL_LABEL_KEYS } from './schemas';
import type { FanSocials, SocialNetwork } from './types';

/**
 * Os links das redes abrem? Só com a API de verdade: nas fixtures e no
 * emulador, os usuários de exemplo (`thalita.teste.up` e os outros) seguem o
 * formato das redes, e qualquer pessoa pode registrá-los; o toque mandaria
 * quem testa para a conta de um estranho (28.1, decisão 25). Vale para o
 * perfil público e para o topo da 1e.
 */
export const linksOpen = (): boolean => sourceOf('profile') === 'api' && !firebaseEmulatorHost;

/** Uma rede com o link montado (o usuário guardado passou no padrão da rede). */
export interface SocialLink {
  network: SocialNetwork;
  handle: string;
  url: string;
}

/** As redes que aparecem, na ordem da lista fixa: a fora do padrão não sai (`socialUrl`). */
export function socialLinksOf(socials: FanSocials | null | undefined): SocialLink[] {
  return SOCIAL_NETWORKS.flatMap((network) => {
    const handle = socials?.[network] ?? null;
    const url = socialUrl(network, handle);
    return handle && url ? [{ network, handle, url }] : [];
  });
}

/** O nome da rede ("Instagram", "X (Twitter)") e o usuário como aparece ("@thalita.teste.up"). */
export function socialLinkText(link: SocialLink): { network: string; handle: string } {
  return {
    network: t(SOCIAL_LABEL_KEYS[link.network]),
    handle: `${SOCIAL_PREFIX[link.network]}${link.handle}`,
  };
}
