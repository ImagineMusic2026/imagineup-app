import type { StyleProp, ViewStyle } from 'react-native';

import { ChipGroup, type ChipItem } from '@/components/chip';
import { t } from '@/i18n';

import { GLOBAL_SCOPE, scopeFromKey, scopeKey, type ScopeKey } from '../scope';
import type { RankingScope } from '../types';

/** Uma central com chip próprio: as que o fã segue, na ordem dele. */
export interface ScopeArtist {
  artistId: string;
  name: string;
}

export interface RankingScopeChipsProps {
  artists: readonly ScopeArtist[];
  value: RankingScope;
  onChange: (scope: RankingScope) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Chips do ranking (1f): "Geral" e um por central que o fã segue. Tocar troca
 * o recorte, com o haptic de seleção do `Chip`. A fileira vai de ponta a ponta
 * e rola na horizontal com muitas centrais. O chip "Amigos" do protótipo
 * (ranking de amigos) está fora do contrato.
 */
export function RankingScopeChips({
  artists,
  value,
  onChange,
  style,
  testID,
}: RankingScopeChipsProps) {
  const items: ChipItem<ScopeKey>[] = [
    {
      value: scopeKey(GLOBAL_SCOPE),
      label: t('ranking.scopes.global'),
      accessibilityHint: t('ranking.scopes.globalHint'),
    },
    ...artists.map((artist) => ({
      value: scopeKey({ kind: 'artist', artistId: artist.artistId }),
      label: artist.name,
      accessibilityHint: t('ranking.scopes.artistHint', { name: artist.name }),
    })),
  ];

  return (
    <ChipGroup
      items={items}
      value={scopeKey(value)}
      onChange={(key) => onChange(scopeFromKey(key))}
      style={style}
      testID={testID}
    />
  );
}
