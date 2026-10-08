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

// --- Editar perfil (bloco 9 e seção 28 de docs/arquitetura-api.md) ---------------

/**
 * O prazo da tentativa do ✓ inteira (esperar a sessão, o token e o pedido do
 * `PUT /me/profile`): a tela fica presa enquanto salva, e sem prazo o fã
 * ficaria preso com sinal ruim (o `timeout` de 15 s do axios só começa depois
 * do token, e o 401 repete o pedido). Passado o prazo, o pedido é cancelado e
 * vira falha incerta, que solta a tela e guarda a chave.
 */
export const PROFILE_SAVE_TIMEOUT_MS = 20_000;

/** Espera entre a última tecla do @ e a consulta de disponibilidade. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;
