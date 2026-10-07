// Loja e resgate (bloco 10): o catálogo em rewards/{rewardId}, os pedidos em
// redemptions/{código}, o resgate numa transação só com o débito pelo núcleo
// de pontos, as callables do painel e o seed. A API
// (src/api/routes/rewards.ts) usa daqui; o seed dos emuladores carrega o
// build (functions/lib/rewards). docs/arquitetura-api.md, seção 25.
export { rewardPanelError, type RewardPanelErrorReason } from './errors';
export {
  CONTACTS_MAX,
  COST_MAX,
  DEFAULT_PER_FAN_LIMIT,
  drawRedemptionCode,
  FAN_REDEMPTIONS_READ_MAX,
  isRedemptionCode,
  isRewardId,
  parseExpectedCost,
  PER_FAN_LIMIT_MAX,
  REDEMPTION_CODE_PATTERN,
  REDEMPTION_DELETE_PAGE,
  REDEMPTION_TRANSITIONS,
  RewardError,
  REWARD_KINDS,
  REWARDS_LIST_MAX,
  REWARDS_REORDER_MAX,
  REWARDS_RULES_URL,
  STOCK_MAX,
  transitionProblem,
  type RedemptionRecord,
  type RedemptionStatus,
  type RewardErrorReason,
  type RewardKind,
  type RewardRecord,
} from './model';
export {
  addReward,
  changeRedemptionStatus,
  changeRewardStatus,
  changeRewardStock,
  editReward,
  newRewardDoc,
  readRedemptionContacts,
  removeReward,
  reorderRewardList,
  type RedemptionContact,
  type RewardsPanelDeps,
} from './panel';
export {
  eveningDaysAgo,
  SEED_REDEMPTIONS,
  SEED_REWARDS,
  SEED_SHOP_ADJUSTMENT,
  seedCamilaRedemptions,
  seedRewards,
  type SeedRedemptionsResult,
} from './seed';
export {
  applyRedemptionStatus,
  cancelFanRedemptions,
  readRewardsForFan,
  redeemReward,
  runRedeemReward,
  runRedemptionStatus,
  type RedeemOutcome,
  type RedemptionStatusChange,
  type RedemptionStatusOutcome,
} from './service';
export { redemptionRef, redemptionsRef, rewardRef, rewardsRef } from './store';
