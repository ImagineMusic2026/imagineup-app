// O check-in diário com sequência (docs/arquitetura-api.md, seção 40): o ícone
// do calendário no topo da Início e o card que ele abre, a pílula da sequência
// da 1e, o estado e as fixtures. Fica atrás da chave do servidor
// (`config/points.checkin.enabled`, que nasce desligada): com ela desligada, ou
// com a `api` de antes (o 404), nada daqui aparece. Os domínios de composição
// (a Início) e o perfil importam daqui; quem só invalida o estado pode ir pela
// chave, no `checkin/keys.ts`.
export {
  CheckinHeaderButton,
  type CheckinHeaderButtonProps,
} from './components/checkin-header-button';
export { CheckinSection, type CheckinSectionProps } from './components/checkin-section';
export { CheckinStreakPill, type CheckinStreakPillProps } from './components/checkin-streak-pill';
export { CHECKIN_FIXTURE_ENABLED, checkinFixture } from './fixtures';
export { useCheckin, type CheckinView } from './hooks/use-checkin';
export { useCheckinPanel, type CheckinPanel } from './hooks/use-checkin-panel';
export { checkinKeys } from './keys';
export { useCheckinMutation, useCheckinQuery, type CheckinAward } from './queries';
export type { CheckinResult, CheckinState, CheckinVariables } from './types';
