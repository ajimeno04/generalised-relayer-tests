export interface GlobalConfig {
  port: number;
  privateKey: string;
  logLevel?: string;
  monitor: MonitorGlobalConfig;
  getter: GetterGlobalConfig;
  pricing: PricingGlobalConfig;
  submitter: SubmitterGlobalConfig;
  persister: PersisterConfig;
  wallet: WalletGlobalConfig;
}

export interface MonitorGlobalConfig {
  interval?: number;
  blockDelay?: number;
}

export interface MonitorConfig extends MonitorGlobalConfig {}

export interface GetterGlobalConfig {
  retryInterval?: number;
  processingInterval?: number;
  maxBlocks?: number;
}

export interface GetterConfig extends GetterGlobalConfig {}

export interface PricingGlobalConfig {
  provider?: string;
  coinDecimals?: number;
  pricingDenomination?: string;
  cacheDuration?: number;
  retryInterval?: number;
  maxTries?: number;
  providerSpecificConfig: Record<string, any>;
};

export interface PricingConfig extends PricingGlobalConfig {}

export interface SubmitterGlobalConfig {
  enabled?: boolean;
  newOrdersDelay?: number;
  retryInterval?: number;
  processingInterval?: number;
  maxTries?: number;
  maxPendingTransactions?: number;

  gasLimitBuffer?: Record<string, number> & { default?: number };
  minDeliveryReward?: number;
  relativeMinDeliveryReward?: number;
  minAckReward?: number;
  relativeMinAckReward?: number;
}

export interface SubmitterConfig extends SubmitterGlobalConfig {}

export interface PersisterConfig {
  enabled: boolean;
  postgresString: string;
}

export interface WalletGlobalConfig {
  retryInterval?: number;
  processingInterval?: number;
  maxTries?: number;
  maxPendingTransactions?: number;
  confirmations?: number;
  confirmationTimeout?: number;
  lowGasBalanceWarning?: bigint;
  gasBalanceUpdateInterval?: number;
  maxFeePerGas?: bigint;
  maxAllowedPriorityFeePerGas?: bigint;
  maxPriorityFeeAdjustmentFactor?: number;
  maxAllowedGasPrice?: bigint;
  gasPriceAdjustmentFactor?: number;
  priorityAdjustmentFactor?: number;
}

export interface WalletConfig extends WalletGlobalConfig {
  rpc?: string;
}

export interface AMBConfig {
  name: string;
  globalProperties: Record<string, any>;
  getIncentivesAddress: (chainId: string) => string;
}

export interface ChainConfig {
  chainId: string;
  name: string;
  rpc: string;
  resolver: string | null;
  startingBlock?: number;
  stoppingBlock?: number;
  monitor: MonitorConfig;
  getter: GetterConfig;
  pricing: PricingConfig;
  submitter: SubmitterConfig;
  wallet: WalletConfig;
}
