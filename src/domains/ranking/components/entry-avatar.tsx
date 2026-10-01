import { Avatar, type AvatarRing } from '@/components/avatar';
import type { AvatarSize } from '@/theme';

import type { LeaderboardEntry } from '../types';

/**
 * O fã que está vendo o ranking, como o app o conhece: nome e foto do perfil
 * (Firestore), que valem mais que os da linha dele.
 */
export interface RankingSelf {
  /** Uid, para a mesma cor de avatar da home e do perfil. */
  id: string;
  name: string | null;
  photoUrl: string | null;
}

export interface EntryAvatarProps {
  entry: LeaderboardEntry;
  self: RankingSelf;
  size: AvatarSize;
  ring?: AvatarRing;
  fallbackColor?: string;
}

/** Avatar de uma posição do ranking; na do próprio fã, o do perfil dele. */
export function EntryAvatar({ entry, self, size, ring, fallbackColor }: EntryAvatarProps) {
  const person = entry.isMe
    ? self
    : { id: entry.userId, name: entry.displayName, photoUrl: entry.photoURL };
  return (
    <Avatar
      name={person.name}
      id={person.id}
      photoUrl={person.photoUrl}
      size={size}
      ring={ring}
      fallbackColor={fallbackColor}
    />
  );
}
