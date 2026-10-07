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

// --- Editar perfil (bloco 9, docs/arquitetura-api.md, 24.12) ---------------------

/**
 * Quanto a tela espera a confirmação do servidor ao salvar nome e cidade: o
 * `updateDoc` do SDK JS só resolve com a resposta, e sem rede fica na fila em
 * memória. Passado o prazo, a tela avisa e o "Salvar" segue desligado até a
 * gravação resolver.
 */
export const PROFILE_SAVE_TIMEOUT_MS = 10_000;

/**
 * O "Salvar" fica desligado depois de salvar: a regra do Firestore aceita uma
 * edição a cada 10 s, contada aqui pelo relógio do aparelho a partir da
 * resposta (sem depender do relógio do servidor).
 */
export const PROFILE_EDIT_COOLDOWN_MS = 10_000;

/** Espera entre a última tecla do @ e a consulta de disponibilidade. */
export const USERNAME_CHECK_DEBOUNCE_MS = 400;
