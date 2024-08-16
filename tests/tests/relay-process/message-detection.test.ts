import { Wallet, parseEther, JsonRpcProvider } from 'ethers6';
import { ATTEMPTS_MAXIMUM, TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../config/config';
import { Transaction, performSwap } from '../utils/perform-swap';
import { IMessageEscrowEvents__factory } from '../../contracts/factories/IMessageEscrowEvents__factory';
import { Store } from '@App/store/store.lib';
import { queryLogs } from '../utils/query-logs';
import { wait } from '@App/common/utils';
import { RelayState } from '@App/store/store.types';

jest.setTimeout(30000000);

let relayState: Partial<RelayState> | null;
let attemptsCounter = 0;
let store: Store;

let config = loadConfig('./tests/config/config.test.yaml');

beforeAll(async () => {
    store = new Store();
});

beforeEach(async () => {
    relayState = null;
    attemptsCounter = 0;
});

afterAll(async () => {
    store.quit();
});

const incentivesEscrowInterface = IMessageEscrowEvents__factory.createInterface();
const incentiveAddress = config.chains[0]?.mock?.incentivesAddress;
const privateKey = config.ambs[0]?.privateKey;
if (!incentiveAddress || !privateKey) {
    throw new Error('Incentive address not found');
}
const provider = new JsonRpcProvider(config.chains[0]?.rpc, undefined, { staticNetwork: true });

const validTransactOpts: Transaction = {
    direction: true,
    swapAmount: parseEther('0.1').toString(),
    incentivePayment: parseEther('0.5').toString(),
    incentive: {
        maxGasDelivery: 2000000,
        maxGasAck: 2000000,
        refundGasTo: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        priceOfDeliveryGas: "50000000000",
        priceOfAckGas: "50000000000",
        targetDelta: 0
    }
};

const runTest = async (
    eventType: string,
    eventInterface: any,
    expectedStructure: Partial<RelayState>,
    transactOpts: Transaction
) => {
    const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

    const tx = await performSwap(wallet, transactOpts);

    const receipt = await tx.wait(1);
    const blockHash = receipt?.blockHash;
    if (!blockHash) {
        throw new Error("Block number not found");
    }
    const log = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyPlaced', provider, blockHash);

    if (log) {
        const parsedLog = eventInterface.parseLog(log);
        const messageIdentifier = parsedLog?.args.messageIdentifier;

        while (attemptsCounter < ATTEMPTS_MAXIMUM && !relayState) {
            relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

            attemptsCounter += 1;
            if (relayState === null) {
                await wait(TIME_BETWEEN_ATTEMPTS);
            }
        }

        if (!relayState) {
            throw new Error("Exceeded maximum attempts or event not found");
        }

        expect(relayState).toMatchObject(expectedStructure);
    } else {
        throw new Error("Log not found");
    }
};

describe('Message Detection Tests', () => {

    it('should retrieve expected Bounty Placed Event transaction successfully', async () => {
        await runTest(
            'BountyPlaced',
            incentivesEscrowInterface,
            {
                status: 0,
                messageIdentifier: expect.any(String),
                bountyPlacedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    fromChainId: expect.any(String),
                    incentivesAddress: expect.any(String),
                    maxGasDelivery: expect.any(BigInt),
                    maxGasAck: expect.any(BigInt),
                    refundGasTo: expect.any(String),
                    priceOfDeliveryGas: expect.any(BigInt),
                    priceOfAckGas: expect.any(BigInt),
                    targetDelta: expect.any(BigInt),
                }
            },
            validTransactOpts
        );
    });

    it('should process multiple BountyPlaced events correctly', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactions = [];
        for (let i = 0; i < 5; i++) {
            const tx = await performSwap(wallet, validTransactOpts);
            transactions.push(tx);
        }

        const logsArray = [];
        for (const tx of transactions) {
            const receipt = await tx.wait(1);
            const blockHash = receipt?.blockHash;
            if (!blockHash) {
                throw new Error("Block number not found");
            }
            const log = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyPlaced', provider, blockHash);
            if (log) {
                logsArray.push(log);
            } else {
                throw new Error("Log not found");
            }
        }

        expect(logsArray.length).toBe(5);

        for (const log of logsArray) {
            const parsedLog = incentivesEscrowInterface.parseLog(log);
            const messageIdentifier = parsedLog?.args['messageIdentifier'];

            while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier)) {
                relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

                attemptsCounter += 1;
                if (relayState === null) {
                    await wait(TIME_BETWEEN_ATTEMPTS);
                }
            }

            if (!relayState) {
                throw new Error("Exceeded maximum attempts or bounty not found");
            }

            expect(relayState.messageIdentifier).toEqual(messageIdentifier);
        }
    });

    it('should process BountyPlaced event with minimum incentive payment', async () => {
        const transactOpts = {
            ...validTransactOpts,
            incentivePayment: parseEther('0.01').toString(),
        };

        await runTest(
            'BountyClaimed',
            incentivesEscrowInterface,
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyPlacedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    fromChainId: expect.any(String),
                    incentivesAddress: expect.any(String),
                    maxGasDelivery: expect.any(BigInt),
                    maxGasAck: expect.any(BigInt),
                    refundGasTo: expect.any(String),
                    priceOfDeliveryGas: expect.any(BigInt),
                    priceOfAckGas: expect.any(BigInt),
                    targetDelta: expect.any(BigInt),
                }
            },
            transactOpts
        );
    });

    it('should not process BountyPlaced event with zero gas prices', async () => {
        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "0",
                priceOfAckGas: "0",
            },
        };

        await runTest(
            'BountyPlaced',
            incentivesEscrowInterface,
            {
                status: 0,
                messageIdentifier: expect.any(String),
                bountyPlacedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    fromChainId: expect.any(String),
                    incentivesAddress: expect.any(String),
                    maxGasDelivery: expect.any(BigInt),
                    maxGasAck: expect.any(BigInt),
                    refundGasTo: expect.any(String),
                    priceOfDeliveryGas: BigInt(0),
                    priceOfAckGas: BigInt(0),
                    targetDelta: expect.any(BigInt),
                }
            },
            transactOpts
        );
    });
});
