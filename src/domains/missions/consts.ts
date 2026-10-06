import {
  Heart,
  MessageCircle,
  Ticket,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

import type { GlyphName } from '@/components/glyph';
import type { IconTileTone } from '@/components/icon-tile';

import type { MissionAction } from './types';

export type MissionIconSpec =
  | { icon: LucideIcon; glyph?: never; tone: IconTileTone; strokeWidth?: number }
  | { glyph: GlyphName; icon?: never; tone: IconTileTone; strokeWidth?: never };

/**
 * Ícone e cor de cada tipo de missão, pela regra de cor do app: rosa para
 * ação, lima para o que é de pontos (trazer gente nova) e ciano para shows. O
 * protótipo pinta o ingresso de rosa; a regra do app (ciano é shows e agenda)
 * vale até o dono dizer o contrário. Traços do protótipo: 1,8 no `Users` e
 * 1,7 no `Ticket`.
 */
export const MISSION_ICONS: Record<MissionAction, MissionIconSpec> = {
  share: { glyph: 'share', tone: 'action' },
  invite: { icon: Users, tone: 'points', strokeWidth: 1.8 },
  like: { icon: Heart, tone: 'action' },
  comment: { icon: MessageCircle, tone: 'action' },
  rsvp: { icon: Ticket, tone: 'events', strokeWidth: 1.7 },
  // Entrar numa central (bloco 7): uma ação do fã, em rosa.
  join: { icon: UserPlus, tone: 'action' },
};
