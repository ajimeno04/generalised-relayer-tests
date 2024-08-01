import { Wallet, parseEther, JsonRpcProvider } from 'ethers6';
import { ATTEMPTS_MAXIMUM, TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../config/config';
import { Transaction, performSwap } from '../utils/perform-swap';
import { IMessageEscrowEvents__factory } from '../../contracts/factories/IMessageEscrowEvents__factory';
import { Store } from '@App/store/store.lib';
import { queryLogs } from '../utils/query-logs';
import { BountyPlacedEvent, BountyClaimedEvent, MessageDeliveredEvent, BountyIncreasedEvent } from '@App/contracts/IMessageEscrowEvents';
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

describe('Incentive Events Tests', () => {

    const runTest = async (eventType: string, eventInterface: any, eventHandler: (log: any, parsedLog: any) => Promise<Partial<RelayState>>, expectedStructure: Partial<RelayState>) => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx = await performSwap(wallet, validTransactOpts)

        const receipt = await tx.wait(1);
        const blockHash = receipt?.blockHash;
        if (!blockHash) {
            throw new Error("Block number not found");
        }
        const log = await queryLogs(incentiveAddress, eventInterface.getEvent(eventType).topicHash, provider, blockHash);

        if (log) {
            const parsedLog = eventInterface.parseLog(log);
            const event = parsedLog?.args;
            const messageIdentifier = event.messageIdentifier;
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

    it('should retrieve expected Bounty Placed Event transaction successfully', async () => {
        await runTest(
            'BountyPlaced',
            incentivesEscrowInterface,
            async (log, parsedLog) => {
                const event = parsedLog?.args as unknown as BountyPlacedEvent.OutputObject;
                const messageIdentifier = event.messageIdentifier;
                const eventDetails = {
                    transactionHash: log.transactionHash,
                    blockHash: log.blockHash,
                    blockNumber: log.blockNumber,
                    fromChainId: config.chains[0]?.chainId,
                    incentivesAddress: log.address,
                    maxGasDelivery: event.incentive.maxGasDelivery,
                    maxGasAck: event.incentive.maxGasAck,
                    refundGasTo: event.incentive.refundGasTo,
                    priceOfDeliveryGas: event.incentive.priceOfDeliveryGas,
                    priceOfAckGas: event.incentive.priceOfAckGas,
                    targetDelta: event.incentive.targetDelta,
                };
                await store.setBountyPlaced(messageIdentifier, eventDetails);
                return { bountyPlacedEvent: eventDetails };
            },
            {
                status: expect.any(Number),
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
            }
        );
    });

    it('should retrieve expected Bounty Claimed Event transaction successfully', async () => {
        await runTest(
            'BountyClaimed',
            incentivesEscrowInterface,
            async (log, parsedLog) => {
                const event = parsedLog?.args as unknown as BountyClaimedEvent.OutputObject;
                const messageIdentifier = event.messageIdentifier;
                const eventDetails = {
                    transactionHash: log.transactionHash,
                    blockHash: log.blockHash,
                    blockNumber: log.blockNumber,
                };
                await store.setBountyClaimed(messageIdentifier, eventDetails);
                return { bountyClaimedEvent: eventDetails };
            },
            {
                status: expect.any(Number),
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            }
        );
    });

    it('should retrieve expected Message Delivered Event transaction successfully', async () => {
        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            async (log, parsedLog) => {
                const event = parsedLog?.args as unknown as MessageDeliveredEvent.OutputObject;
                const messageIdentifier = event.messageIdentifier;
                const eventDetails = {
                    transactionHash: log.transactionHash,
                    blockHash: log.blockHash,
                    blockNumber: log.blockNumber,
                    toChainId: config.chains[0]?.chainId,
                };
                await store.setMessageDelivered(messageIdentifier, eventDetails);
                return { messageDeliveredEvent: eventDetails };
            },
            {
                status: expect.any(Number),
                messageIdentifier: expect.any(String),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            }
        );
    });

    it('should retrieve expected Bounty Increased Event transaction successfully', async () => {
        await runTest(
            'BountyIncreased',
            incentivesEscrowInterface,
            async (log, parsedLog) => {
                const event = parsedLog?.args as unknown as BountyIncreasedEvent.OutputObject;
                const messageIdentifier = event.messageIdentifier;
                const eventDetails = {
                    transactionHash: log.transactionHash,
                    blockHash: log.blockHash,
                    blockNumber: log.blockNumber,
                    newDeliveryGasPrice: event.newDeliveryGasPrice,
                    newAckGasPrice: event.newAckGasPrice,
                };
                await store.setBountyIncreased(messageIdentifier, eventDetails);
                return { bountyIncreasedEvent: eventDetails };
            },
            {
                status: expect.any(Number),
                messageIdentifier: expect.any(String),
                bountyIncreasedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    newDeliveryGasPrice: expect.any(BigInt),
                    newAckGasPrice: expect.any(BigInt),
                }
            }
        );
    });

    // Additional Tests

    it('should process multiple BountyPlaced events correctly', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts)
        const tx2 = await performSwap(wallet, validTransactOpts)

        const receipt1 = await tx1.wait(1);
        const receipt2 = await tx2.wait(1);
        const blockHash1 = receipt1?.blockHash;
        const blockHash2 = receipt2?.blockHash;

        if (!blockHash1 || !blockHash2) {
            throw new Error("Block number not found");
        }

        const logs1 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash1);
        const logs2 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash2);

        expect(logs1).not.toBeNull();
        expect(logs2).not.toBeNull();

        if (!logs1 || !logs2) {
            throw new Error("Log not found");
        }

        const parsedLog1 = incentivesEscrowInterface.parseLog(logs1);
        const parsedLog2 = incentivesEscrowInterface.parseLog(logs2);

        const messageIdentifier1 = parsedLog1?.args['messageIdentifier'];
        const messageIdentifier2 = parsedLog2?.args['messageIdentifier'];

        while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier2)) {
            relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier2);

            attemptsCounter += 1;
            if (relayState === null) {
                await wait(TIME_BETWEEN_ATTEMPTS);
            }
        }

        if (!relayState) {
            throw new Error("Exceeded maximum attempts or bounty not found");
        }

        expect(relayState.messageIdentifier).toEqual(messageIdentifier2);
    });

    it('should handle events processed in reverse order', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts)
        const tx2 = await performSwap(wallet, validTransactOpts)

        const receipt1 = await tx1.wait(1);
        const receipt2 = await tx2.wait(1);
        const blockHash1 = receipt1?.blockHash;
        const blockHash2 = receipt2?.blockHash;

        if (!blockHash1 || !blockHash2) {
            throw new Error("Block number not found");
        }

        const logs1 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash1);
        const logs2 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash2);

        expect(logs1).not.toBeNull();
        expect(logs2).not.toBeNull();

        if (!logs1 || !logs2) {
            throw new Error("Log not found");
        }

        const parsedLog1 = incentivesEscrowInterface.parseLog(logs1);
        const parsedLog2 = incentivesEscrowInterface.parseLog(logs2);

        const messageIdentifier1 = parsedLog1?.args['messageIdentifier'];
        const messageIdentifier2 = parsedLog2?.args['messageIdentifier'];

        // Process second event first
        await store.setBountyPlaced(messageIdentifier2, {
            transactionHash: logs2.transactionHash,
            blockHash: logs2.blockHash,
            blockNumber: logs2.blockNumber,
            fromChainId: config.chains[0]?.chainId,
            incentivesAddress: logs2.address,
            maxGasDelivery: parsedLog2?.args['incentive'].maxGasDelivery,
            maxGasAck: parsedLog2?.args['incentive'].maxGasAck,
            refundGasTo: parsedLog2?.args.incentive.refundGasTo,
            priceOfDeliveryGas: parsedLog2?.args.incentive.priceOfDeliveryGas,
            priceOfAckGas: parsedLog2?.args.incentive.priceOfAckGas,
            targetDelta: parsedLog2.args.incentive.targetDelta,
        });

        // Then process first event
        await store.setBountyPlaced(messageIdentifier1, {
            transactionHash: logs1.transactionHash,
            blockHash: logs1.blockHash,
            blockNumber: logs1.blockNumber,
            fromChainId: config.chains[0]?.chainId,
            incentivesAddress: logs1.address,
            maxGasDelivery: parsedLog1.args.incentive.maxGasDelivery,
            maxGasAck: parsedLog1.args.incentive.maxGasAck,
            refundGasTo: parsedLog1.args.incentive.refundGasTo,
            priceOfDeliveryGas: parsedLog1.args.incentive.priceOfDeliveryGas,
            priceOfAckGas: parsedLog1.args.incentive.priceOfAckGas,
            targetDelta: parsedLog1.args.incentive.targetDelta,
        });

        while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier1)) {
            relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier1);

            attemptsCounter += 1;
            if (relayState === null) {
                await wait(TIME_BETWEEN_ATTEMPTS);
            }
        }

        if (!relayState) {
            throw new Error("Exceeded maximum attempts or bounty not found");
        }

        expect(relayState.messageIdentifier).toEqual(messageIdentifier1);
    });

    it('should retry processing an event on failure', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx = await performSwap(wallet, validTransactOpts)
        const receipt = await tx.wait(1);
        const blockHash = receipt?.blockHash;
        if (!blockHash) {
            throw new Error("Block number not found");
        }
        const logs = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash);
        expect(logs).not.toBeNull();

        const parsedLog = incentivesEscrowInterface.parseLog(logs);
        const messageIdentifier = parsedLog?.args.messageIdentifier;

        let failOnce = true;
        jest.spyOn(store, 'setBountyPlaced').mockImplementation(async (identifier, details) => {
            if (failOnce) {
                failOnce = false;
                throw new Error("Simulated failure");
            }
            return Promise.resolve();
        });

        try {
            await store.setBountyPlaced(messageIdentifier, {
                transactionHash: logs.transactionHash,
                blockHash: logs.blockHash,
                blockNumber: logs.blockNumber,
                fromChainId: config.chains[0]?.chainId,
                incentivesAddress: logs.address,
                maxGasDelivery: parsedLog.args.incentive.maxGasDelivery,
                maxGasAck: parsedLog.args.incentive.maxGasAck,
                refundGasTo: parsedLog.args.incentive.refundGasTo,
                priceOfDeliveryGas: parsedLog.args.incentive.priceOfDeliveryGas,
                priceOfAckGas: parsedLog.args.incentive.priceOfAckGas,
                targetDelta: parsedLog.args.incentive.targetDelta,
            });
        } catch (e) {
            await wait(config.retryInterval);
            await store.setBountyPlaced(messageIdentifier, {
                transactionHash: logs.transactionHash,
                blockHash: logs.blockHash,
                blockNumber: logs.blockNumber,
                fromChainId: config.chains[0]?.chainId,
                incentivesAddress: logs.address,
                maxGasDelivery: parsedLog.args.incentive.maxGasDelivery,
                maxGasAck: parsedLog.args.incentive.maxGasAck,
                refundGasTo: parsedLog.args.incentive.refundGasTo,
                priceOfDeliveryGas: parsedLog.args.incentive.priceOfDeliveryGas,
                priceOfAckGas: parsedLog.args.incentive.priceOfAckGas,
                targetDelta: parsedLog.args.incentive.targetDelta,
            });
        }

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
    });

    it('should handle a mix of different events in one batch', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts)
        const tx2 = await performSwap(wallet, validTransactOpts)
        const tx3 = await performSwap(wallet, validTransactOpts)
        const tx4 = await performSwap(wallet, validTransactOpts)

        const receipt1 = await tx1.wait(1);
        const receipt2 = await tx2.wait(1);
        const receipt3 = await tx3.wait(1);
        const receipt4 = await tx4.wait(1);
        const blockHash1 = receipt1?.blockHash;
        const blockHash2 = receipt2?.blockHash;
        const blockHash3 = receipt3?.blockHash;
        const blockHash4 = receipt4?.blockHash;

        if (!blockHash1 || !blockHash2 || !blockHash3 || !blockHash4) {
            throw new Error("Block number not found");
        }

        const logs1 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash1);
        const logs2 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyClaimed').topicHash, provider, blockHash2);
        const logs3 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('MessageDelivered').topicHash, provider, blockHash3);
        const logs4 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyIncreased').topicHash, provider, blockHash4);

        expect(logs1).not.toBeNull();
        expect(logs2).not.toBeNull();
        expect(logs3).not.toBeNull();
        expect(logs4).not.toBeNull();

        const parsedLog1 = incentivesEscrowInterface.parseLog(logs1);
        const parsedLog2 = incentivesEscrowInterface.parseLog(logs2);
        const parsedLog3 = incentivesEscrowInterface.parseLog(logs3);
        const parsedLog4 = incentivesEscrowInterface.parseLog(logs4);

        const messageIdentifier1 = parsedLog1?.args.messageIdentifier;
        const messageIdentifier2 = parsedLog2?.args.messageIdentifier;
        const messageIdentifier3 = parsedLog3?.args.messageIdentifier;
        const messageIdentifier4 = parsedLog4?.args.messageIdentifier;

        await store.setBountyPlaced(messageIdentifier1, {
            transactionHash: logs1.transactionHash,
            blockHash: logs1.blockHash,
            blockNumber: logs1.blockNumber,
            fromChainId: config.chains[0]?.chainId,
            incentivesAddress: logs1.address,
            maxGasDelivery: parsedLog1.args.incentive.maxGasDelivery,
            maxGasAck: parsedLog1.args.incentive.maxGasAck,
            refundGasTo: parsedLog1.args.incentive.refundGasTo,
            priceOfDeliveryGas: parsedLog1.args.incentive.priceOfDeliveryGas,
            priceOfAckGas: parsedLog1.args.incentive.priceOfAckGas,
            targetDelta: parsedLog1.args.incentive.targetDelta,
        });

        await store.setBountyClaimed(messageIdentifier2, {
            transactionHash: logs2.transactionHash,
            blockHash: logs2.blockHash,
            blockNumber: logs2.blockNumber,
        });

        await store.setMessageDelivered(messageIdentifier3, {
            transactionHash: logs3.transactionHash,
            blockHash: logs3.blockHash,
            blockNumber: logs3.blockNumber,
            toChainId: config.chains[0]?.chainId,
        });

        await store.setBountyIncreased(messageIdentifier4, {
            transactionHash: logs4.transactionHash,
            blockHash: logs4.blockHash,
            blockNumber: logs4.blockNumber,
            newDeliveryGasPrice: parsedLog4.args.newDeliveryGasPrice,
            newAckGasPrice: parsedLog4.args.newAckGasPrice,
        });

        while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier4)) {
            relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier4);

            attemptsCounter += 1;
            if (relayState === null) {
                await wait(TIME_BETWEEN_ATTEMPTS);
            }
        }

        if (!relayState) {
            throw new Error("Exceeded maximum attempts or bounty not found");
        }

        expect(relayState.messageIdentifier).toEqual(messageIdentifier4);
    });

});
