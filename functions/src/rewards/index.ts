// Loja e resgate (bloco 10): o catálogo em rewards/{rewardId}, os pedidos em
// redemptions/{código}, o resgate numa transação só com o débito pelo núcleo
// de pontos, as callables do painel, o pedido de prêmio de fã-clube (seção
// 34) e o seed. A API
// (src/api/routes/rewards.ts) usa daqui; o seed dos emuladores carrega o
// build (functions/lib/rewards). docs/arquitetura-api.md, seção 25.
export { rewardPanelError, type RewardPanelErrorReason } from './errors';
export {
  CONTACTS_MAX,
  COST_MAX,
  DEFAULT_PER_FAN_LIMIT,
  drawRedemptionCode,
  FAN_PRIZES_MAX,
  FAN_REDEMPTIONS_READ_MAX,
  isPrizeRedemption,
  isPrizeReward,
  isRedemptionCode,
  isRewardId,
  parseExpectedCost,
  PER_FAN_LIMIT_MAX,
  prizeRewardProblem,
  prizeView,
  REDEMPTION_CODE_PATTERN,
  REDEMPTION_DELETE_PAGE,
  REDEMPTION_TRANSITIONS,
  RewardError,
  REWARD_KINDS,
  REWARDS_LIST_MAX,
  REWARDS_REORDER_MAX,
  REWARDS_RULES_URL,
  STOCK_MAX,
  STORE_REWARD_KINDS,
  transitionProblem,
  type RedemptionOrigin,
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
  SEED_OPEN_REDEMPTION_REWARD,
  SEED_OPEN_REDEMPTIONS,
  SEED_PRIZE_REWARD,
  SEED_REDEMPTIONS,
  SEED_REWARDS,
  SEED_SHOP_ADJUSTMENT,
  seedCamilaRedemptions,
  seedOpenRedemptions,
  seedPrizeReward,
  seedRewards,
  type SeedRedemptionsResult,
} from './seed';
export {
  applyRedemptionStatus,
  cancelFanRedemptions,
  grantPrize,
  readRewardsForFan,
  redeemReward,
  runRedeemReward,
  runRedemptionStatus,
  type PrizeGrant,
  type RedeemOutcome,
  type RedemptionStatusChange,
  type RedemptionStatusOutcome,
} from './service';
export { redemptionRef, redemptionsRef, rewardRef, rewardsRef } from './store';
