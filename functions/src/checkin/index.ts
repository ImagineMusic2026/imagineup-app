// Check-in diário com sequência (docs/arquitetura-api.md, seção 40): o modelo
// puro (a chave e o ciclo de config/points.checkin, a sequência guardada em
// wallets/{uid}.checkin, a regra do dia e a resposta das rotas), o núcleo do
// `POST /me/checkin` e o seed dos emuladores, que carrega o build
// (functions/lib/checkin). O núcleo de pontos importa o modelo direto
// (`../checkin/model`), nunca este índice: o serviço e o seed importam dele.
export {
  CHECKIN_CYCLE_DAYS,
  CHECKIN_VALUE_MAX,
  CHECKIN_VALUE_MIN,
  CheckinError,
  checkinView,
  DEFAULT_CHECKIN_CONFIG,
  effectiveStreak,
  EMPTY_CHECKIN_RECORD,
  parseCheckinConfig,
  parseCheckinRecord,
  planCheckin,
  validateCheckinInput,
  type CheckinConfig,
  type CheckinErrorReason,
  type CheckinLog,
  type CheckinPlan,
  type CheckinRecord,
} from './model';
export {
  CAMILA_SEED_STREAK,
  SEED_STREAK_ACHIEVEMENTS,
  seedCamilaCheckins,
  seedCheckinConfig,
  type SeedCheckinConfigResult,
} from './seed';
export { checkIn, runCheckin, type CheckinOutcome } from './service';
