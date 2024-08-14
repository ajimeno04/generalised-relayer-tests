import { Wallet, parseEther, JsonRpcProvider } from 'ethers6';
import { ATTEMPTS_MAXIMUM, TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../../config/config';
import { Transaction, performSwap } from '../../utils/perform-swap';
import { IMessageEscrowEvents__factory } from '../../../contracts/factories/IMessageEscrowEvents__factory';
import { Store } from '@App/store/store.lib';
import { queryLogs } from '../../utils/query-logs';
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

const runTest = async (eventType: string, eventInterface: any, expectedStructure: Partial<RelayState>) => {
    const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

    const tx = await performSwap(wallet, validTransactOpts);

    const receipt = await tx.wait(1);
    const blockHash = receipt?.blockHash;
    if (!blockHash) {
        throw new Error("Block number not found");
    }
    const log = await queryLogs(incentiveAddress, eventInterface.getEvent(eventType).topicHash, provider, blockHash);

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

describe('Incentive Events Tests', () => {

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
            }
        );
    });



    it('should retrieve expected Message Delivered Event transaction successfully', async () => {
        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            {
                status: 1,
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

    it('should retrieve expected Bounty Claimed Event transaction successfully', async () => {
        await runTest(
            'BountyClaimed',
            incentivesEscrowInterface,
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            }
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
            const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash);
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
    it('should process multiple BountyClaimed events correctly', async () => {
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
            const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyClaimed').topicHash, provider, blockHash);
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

    it('should process multiple MessageDelivered events correctly', async () => {
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
            const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('MessageDelivered').topicHash, provider, blockHash);
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
                throw new Error("Exceeded maximum attempts or message not found");
            }

            expect(relayState.messageIdentifier).toEqual(messageIdentifier);
        }
    });


    it('should handle a mix of different events in one batch', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts);
        const tx2 = await performSwap(wallet, validTransactOpts);
        const tx3 = await performSwap(wallet, validTransactOpts);
        const tx4 = await performSwap(wallet, validTransactOpts);

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

        if (!logs1 || !logs2 || !logs3 || !logs4) {
            throw new Error("Log not found");
        }
        const parsedLog1 = incentivesEscrowInterface.parseLog(logs1);
        const parsedLog2 = incentivesEscrowInterface.parseLog(logs2);
        const parsedLog3 = incentivesEscrowInterface.parseLog(logs3);
        const parsedLog4 = incentivesEscrowInterface.parseLog(logs4);

        const messageIdentifier1 = parsedLog1?.args['messageIdentifier'];
        const messageIdentifier2 = parsedLog2?.args['messageIdentifier'];
        const messageIdentifier3 = parsedLog3?.args['messageIdentifier'];
        const messageIdentifier4 = parsedLog4?.args['messageIdentifier'];

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

    it('should process the complete flow of events (BountyPlaced, MessageDelivered, BountyClaimed)', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts);
        const receipt1 = await tx1.wait(1);
        const blockHash1 = receipt1?.blockHash;
        if (!blockHash1) {
            throw new Error("Block number not found");
        }

        const log1 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash1);
        expect(log1).not.toBeNull();

        if (!log1) {
            throw new Error("Log not found");
        }
        const parsedLog1 = incentivesEscrowInterface.parseLog(log1);
        const messageIdentifier = parsedLog1?.args['messageIdentifier'];

        const tx2 = await performSwap(wallet, validTransactOpts);
        const receipt2 = await tx2.wait(1);
        const blockHash2 = receipt2?.blockHash;
        if (!blockHash2) {
            throw new Error("Block number not found");
        }

        const log2 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('MessageDelivered').topicHash, provider, blockHash2);
        expect(log2).not.toBeNull();

        const tx3 = await performSwap(wallet, validTransactOpts);
        const receipt3 = await tx3.wait(1);
        const blockHash3 = receipt3?.blockHash;
        if (!blockHash3) {
            throw new Error("Block number not found");
        }

        const log3 = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyClaimed').topicHash, provider, blockHash3);
        expect(log3).not.toBeNull();

        while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier)) {
            relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

            attemptsCounter += 1;
            if (relayState === null) {
                await wait(TIME_BETWEEN_ATTEMPTS);
            }
        }

        if (!relayState) {
            throw new Error("Exceeded maximum attempts or events not found");
        }

        expect(relayState).toMatchObject({
            status: 2,
            messageIdentifier: messageIdentifier,
            bountyPlacedEvent: {
                transactionHash: log1.transactionHash,
                blockHash: log1.blockHash,
                blockNumber: log1.blockNumber,
                fromChainId: config.chains[0]?.chainId,
                incentivesAddress: log1.address,
                maxGasDelivery: parsedLog1?.args['incentive'].maxGasDelivery,
                maxGasAck: parsedLog1?.args['incentive'].maxGasAck,
                refundGasTo: parsedLog1?.args['incentive'].refundGasTo,
                priceOfDeliveryGas: parsedLog1?.args['incentive'].priceOfDeliveryGas,
                priceOfAckGas: parsedLog1?.args['incentive'].priceOfAckGas,
                targetDelta: parsedLog1?.args['incentive'].targetDelta,
            },
            messageDeliveredEvent: {
                transactionHash: log2?.transactionHash,
                blockHash: log2?.blockHash,
                blockNumber: log2?.blockNumber,
                toChainId: config.chains[0]?.chainId,
            },
            bountyClaimedEvent: {
                transactionHash: log3?.transactionHash,
                blockHash: log3?.blockHash,
                blockNumber: log3?.blockNumber,
            }
        });
    });

    it('should not retrieve relay state for BountyPlaced event with incorrect data', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx = await performSwap(wallet, {
            ...validTransactOpts,
            swapAmount: parseEther('0.0').toString(),
        });

        const receipt = await tx.wait(1);
        const blockHash = receipt?.blockHash;
        if (!blockHash) {
            throw new Error("Block number not found");
        }

        const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, blockHash);

        if (log) {
            const parsedLog = incentivesEscrowInterface.parseLog(log);
            const messageIdentifier = parsedLog?.args['messageIdentifier'];

            let relayState: Partial<RelayState> | null = null;
            let attemptsCounter = 0;
            while (attemptsCounter < ATTEMPTS_MAXIMUM && !relayState) {
                relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

                attemptsCounter += 1;
                if (relayState === null) {
                    await wait(TIME_BETWEEN_ATTEMPTS);
                }
            }

            expect(relayState).toBeNull();
        } else {
            throw new Error("Log not found");
        }
    });

    it('should not retrieve relay state for MessageDelivered event with incorrect data', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx = await performSwap(wallet, {
            ...validTransactOpts,
            direction: false,
        });

        const receipt = await tx.wait(1);
        const blockHash = receipt?.blockHash;
        if (!blockHash) {
            throw new Error("Block number not found");
        }

        const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('MessageDelivered').topicHash, provider, blockHash);

        if (log) {
            const parsedLog = incentivesEscrowInterface.parseLog(log);
            const messageIdentifier = parsedLog?.args['messageIdentifier'];

            let relayState: Partial<RelayState> | null = null;
            let attemptsCounter = 0;
            while (attemptsCounter < ATTEMPTS_MAXIMUM && !relayState) {
                relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

                attemptsCounter += 1;
                if (relayState === null) {
                    await wait(TIME_BETWEEN_ATTEMPTS);
                }
            }

            expect(relayState).toBeNull();
        } else {
            throw new Error("Log not found");
        }
    });

    it('should not retrieve relay state for BountyClaimed event with incorrect data', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx = await performSwap(wallet, {
            ...validTransactOpts,
            incentivePayment: parseEther('0.0').toString(),
        });

        const receipt = await tx.wait(1);
        const blockHash = receipt?.blockHash;
        if (!blockHash) {
            throw new Error("Block number not found");
        }

        const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyClaimed').topicHash, provider, blockHash);

        if (log) {
            const parsedLog = incentivesEscrowInterface.parseLog(log);
            const messageIdentifier = parsedLog?.args['messageIdentifier'];

            let relayState: Partial<RelayState> | null = null;
            let attemptsCounter = 0;
            while (attemptsCounter < ATTEMPTS_MAXIMUM && !relayState) {
                relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);

                attemptsCounter += 1;
                if (relayState === null) {
                    await wait(TIME_BETWEEN_ATTEMPTS);
                }
            }

            expect(relayState).toBeNull();
        } else {
            throw new Error("Log not found");
        }
    });
    it('should process MessageDelivered event with low gas prices', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "1000000000",
                priceOfAckGas: "1000000000",
            },
        };

        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            {
                status: 1,
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

    it('should process MessageDelivered event with low gas prices', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "1000000000",
                priceOfAckGas: "1000000000",
            },
        };

        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            {
                status: 1,
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
    it('should process BountyClaimed event with very high gas prices', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "100000000000",
                priceOfAckGas: "100000000000",
            },
        };

        await runTest(
            'BountyClaimed',
            incentivesEscrowInterface,
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            }
        );
    });
    it('should process BountyPlaced event with minimum incentive payment', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

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
            }
        );
    });

    it('should process BountyPlaced event with invalid refund address', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                refundGasTo: '0x0000000000000000000000000000000000000000',
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
                    refundGasTo: '0x0000000000000000000000000000000000000000',
                    priceOfDeliveryGas: expect.any(BigInt),
                    priceOfAckGas: expect.any(BigInt),
                    targetDelta: expect.any(BigInt),
                }
            }
        );
    });
    it('should handle MessageDelivered event with invalid chain ID gracefully', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            direction: !validTransactOpts.direction,
            incentive: {
                ...validTransactOpts.incentive,
                toChainId: '0xINVALIDCHAINID',
            },
        };

        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            {
                status: 1,
                messageIdentifier: expect.any(String),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: '0xINVALIDCHAINID',
                }
            }
        );
    });

    it('should process BountyClaimed event with negative target delta', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                targetDelta: -100,
            },
        };

        await runTest(
            'BountyClaimed',
            incentivesEscrowInterface,
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            }
        );
    });
    it('should process BountyPlaced event with very high swap amount', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            swapAmount: parseEther('10000').toString(),
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
                    priceOfDeliveryGas: expect.any(BigInt),
                    priceOfAckGas: expect.any(BigInt),
                    targetDelta: expect.any(BigInt),
                }
            }
        );
    });
    it('should process MessageDelivered event with very low incentive payment', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactOpts = {
            ...validTransactOpts,
            incentivePayment: parseEther('0.0001').toString(),
        };

        await runTest(
            'MessageDelivered',
            incentivesEscrowInterface,
            {
                status: 1,
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
    it('should not process BountyPlaced event with zero gas prices', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

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
            }
        );
    });

});
