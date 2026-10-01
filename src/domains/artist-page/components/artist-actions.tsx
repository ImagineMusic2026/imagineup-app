import { Check } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { PointsToast } from '@/components/points-toast';
import { Skeleton, SkeletonGroup } from '@/components/skeleton';
import type { ArtistDetails, JoinAward } from '@/domains/artists';
import { t } from '@/i18n';
import { layout, radii, spacing } from '@/theme';

export interface ArtistActionsProps {
  /** `undefined` enquanto a central chega. */
  artist: ArtistDetails | undefined;
  onJoin: () => void;
  /** Pontos que entrar rendeu, vindos da API: o "+N" sobe do botão. */
  award: JoinAward | null;
}

const hiddenFromReader = {
  accessible: false,
  importantForAccessibility: 'no-hide-descendants',
  accessibilityElementsHidden: true,
} as const;

/**
 * O botão da central (1d), na linha inteira: o sino (notificações) e a nota
 * (playlists e streaming) do protótipo estão fora do contrato. Fora da
 * central, "Entrar na central" em rosa; dentro, "Na central" escuro com o
 * check, que é estado e não ação (sair da central fica para quando o menu
 * "mais" existir): sem toque e lido como texto. É o mesmo `Button` nos dois
 * estados, e a troca de rosa para escuro é a dele, em HSV e com o rótulo em
 * fade.
 *
 * Sem margem embaixo: a aba de 44 logo abaixo já traz o respiro até o traço.
 */
export function ArtistActions({ artist, onJoin, award }: ArtistActionsProps) {
  if (!artist) {
    // O leitor ouve "Carregando a central" uma vez só, na capa.
    return (
      <View {...hiddenFromReader}>
        <SkeletonGroup style={styles.row}>
          <Skeleton height={layout.buttonHeight.md} radius={radii.sm} />
        </SkeletonGroup>
      </View>
    );
  }

  const member = artist.isMember;
  return (
    <View style={styles.row}>
      {/* O "+N" nasce na borda de cima do botão. */}
      <View>
        <Button
          label={t(member ? 'artist.join.member' : 'artist.join.action')}
          icon={member ? Check : undefined}
          variant={member ? 'secondary' : 'primary'}
          size="md"
          readOnly={member}
          haptic="confirm"
          onPress={onJoin}
          accessibilityLabel={t(member ? 'artist.join.memberLabel' : 'artist.join.label', {
            name: artist.name,
          })}
          testID="artist-join"
        />
        <PointsToast
          points={award?.points ?? 0}
          trigger={award?.id ?? null}
          testID="artist-join-points"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.gutter,
  },
});
