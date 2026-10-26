// Cada ícone pelo próprio caminho: o índice do pacote leva os 1.500 ícones
// para o bundle (o Metro não descarta o que não é usado).
import { CalendarCheckIcon } from 'phosphor-react-native/src/icons/CalendarCheck';
import { ChatCircleDotsIcon } from 'phosphor-react-native/src/icons/ChatCircleDots';
import { FireIcon } from 'phosphor-react-native/src/icons/Fire';
import { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
import { MedalIcon } from 'phosphor-react-native/src/icons/Medal';
import { ShareFatIcon } from 'phosphor-react-native/src/icons/ShareFat';
import { StarIcon } from 'phosphor-react-native/src/icons/Star';
import { TicketIcon } from 'phosphor-react-native/src/icons/Ticket';
import { TrophyIcon } from 'phosphor-react-native/src/icons/Trophy';
import { UsersThreeIcon } from 'phosphor-react-native/src/icons/UsersThree';

import { colors } from '@/theme';

import type { AchievementTone } from './types';

/** Um ícone do Phosphor (todos têm a mesma assinatura). */
export type AchievementIconComponent = typeof MedalIcon;

/**
 * Ícones das conquistas pela chave que vem do painel, no Phosphor (o estilo
 * duotone de medalha, decisão do dono de 26/10/2026; o resto do app segue no
 * lucide). As chaves não mudam: o painel continua mandando as mesmas. Chave
 * desconhecida cai em `FALLBACK_ACHIEVEMENT_ICON`.
 */
export const ACHIEVEMENT_ICONS: Readonly<Record<string, AchievementIconComponent>> = {
  share: ShareFatIcon,
  trophy: TrophyIcon,
  ticket: TicketIcon,
  star: StarIcon,
  users: UsersThreeIcon,
  heart: HeartIcon,
  comment: ChatCircleDotsIcon,
  calendar: CalendarCheckIcon,
  flame: FireIcon,
};

export const FALLBACK_ACHIEVEMENT_ICON: AchievementIconComponent = MedalIcon;

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
