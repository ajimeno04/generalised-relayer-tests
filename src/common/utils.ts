import { AbiCoder, keccak256 } from 'ethers6';
import { BountyStatus } from 'src/store/types/bounty.enum';
import { Bounty } from 'src/store/types/store.types';

const defaultAbiCoder = AbiCoder.defaultAbiCoder();

export const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Stringifying bounty status for display
 * @param status Bounty Status
 * @returns The bounty status as a string
 */
export const getBountyStatus = (status: BountyStatus): string => {
  switch (status) {
    case BountyStatus.BountyPlaced:
      return 'Bounty Placed';
    case BountyStatus.MessageDelivered:
      return 'Message Delivered';
    case BountyStatus.BountyClaimed:
      return 'Bounty Claimed';
  }
};

/**
 * Adds 0x to the begining of an address
 * @param address address string
 * @returns The string with 0x
 */
export const add0X = (address: string): string => `0x${address}`;

export const convertHexToDecimal = (hex: string) => BigInt(hex).toString();

export const bountyToDTO = (bounty: Bounty) => ({
  messageIdentifier: bounty.messageIdentifier,
  maxGasDelivery: bounty.maxGasDelivery.toString(),
  maxGasAck: bounty.maxGasAck.toString(),
  refundGasTo: bounty.refundGasTo,
  priceOfDeliveryGas: bounty.priceOfDeliveryGas.toString(),
  priceOfAckGas: bounty.priceOfAckGas.toString(),
  targetDelta: bounty.targetDelta.toString(),
  status: getBountyStatus(bounty.status),
});

export const getSwapIdentifier = (
  toAccount: string,
  units: bigint,
  fromAmountMinusFee: bigint,
  fromAsset: string,
  blockNumber: number,
) => {
  return keccak256(
    defaultAbiCoder.encode(
      ['bytes', 'uint256', 'uint256', 'address', 'uint32'],
      [toAccount, units, fromAmountMinusFee, fromAsset, blockNumber % 2 ** 32],
    ),
  );
};

export const tryErrorToString = (error: any): string | undefined => {
  if (error == undefined) {
      return undefined;
  }
  if (typeof error == "string") {
      return error;
  }
  try {
      return error.toString();
  } catch {
      return 'Unable to stringify error.';
  }
}