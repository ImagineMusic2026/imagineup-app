import {
  Award,
  CalendarCheck,
  Flame,
  Heart,
  MessageCircle,
  Star,
  Ticket,
  Users,
  type LucideIcon,
} from 'lucide-react-native';

import type { GlyphName } from '@/components/glyph';
import { colors } from '@/theme';

import type { AchievementTone } from './types';

/**
 * Ícones das conquistas desenhados no protótipo, pela chave que vem do
 * painel: a seta cheia de compartilhar ("Boca a boca") e a taça fina ("Top
 * 20"). Vencem `ACHIEVEMENT_ICONS`.
 */
export const ACHIEVEMENT_GLYPHS: Readonly<Record<string, GlyphName>> = {
  share: 'share',
  trophy: 'goblet',
};

/**
 * Ícones do lucide para as outras chaves que vêm do painel. Chave
 * desconhecida cai em `FALLBACK_ACHIEVEMENT_ICON`.
 */
export const ACHIEVEMENT_ICONS: Readonly<Record<string, LucideIcon>> = {
  ticket: Ticket,
  star: Star,
  users: Users,
  heart: Heart,
  comment: MessageCircle,
  calendar: CalendarCheck,
  flame: Flame,
};

export const FALLBACK_ACHIEVEMENT_ICON = Award;

/** Rosa para ação e convite, lima para pontos e ranking, ciano para shows. */
export const ACHIEVEMENT_TONE_COLORS: Readonly<Record<AchievementTone, string>> = {
  action: colors.accent,
  points: colors.points,
  events: colors.events,
};

/** Quantas peças de conquista cabem na linha do perfil. */
export const ACHIEVEMENT_SLOTS = 4;
