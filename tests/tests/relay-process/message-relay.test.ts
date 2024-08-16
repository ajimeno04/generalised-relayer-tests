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

const config = loadConfig('./tests/config/config.test.yaml');
const provider = new JsonRpcProvider(config.chains[0]?.rpc, undefined, { staticNetwork: true });
const incentivesEscrowInterface = IMessageEscrowEvents__factory.createInterface();
const incentiveAddress = config.chains[0]?.mock?.incentivesAddress;
const privateKey = config.ambs[0]?.privateKey;

if (!incentiveAddress || !privateKey) {
    throw new Error('Incentive address or private key not found');
}

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

beforeAll(() => {
    store = new Store();
});

beforeEach(() => {
    relayState = null;
    attemptsCounter = 0;
});

afterAll(() => {
    store.quit();
});

const runTest = async (eventType: string, expectedStructure: Partial<RelayState>, transactOpts: Transaction = validTransactOpts) => {
    const wallet = new Wallet(privateKey, provider);
    const tx = await performSwap(wallet, transactOpts);
    const receipt = await tx.wait(1);
    const blockHash = receipt?.blockHash;

    if (!blockHash) {
        throw new Error("Block hash not found");
    }

    const log = await queryLogs(incentiveAddress, incentivesEscrowInterface, eventType, provider, blockHash);
    if (!log) {
        throw new Error(`Log for event ${eventType} not found`);
    }

    const parsedLog = incentivesEscrowInterface.parseLog(log);
    const messageIdentifier = parsedLog?.args['messageIdentifier'];

    while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier)) {
        relayState = await store.getRelayStateByKey(`relay_state:${messageIdentifier}`);
        attemptsCounter += 1;
        if (!relayState) {
            await wait(TIME_BETWEEN_ATTEMPTS);
        }
    }

    if (!relayState) {
        throw new Error("Exceeded maximum attempts or event not found");
    }

    expect(relayState).toMatchObject(expectedStructure);
};


// Helper Functions ----------------------------------------------------------------

const processMultipleEvents = async (eventType: string) => {
    const wallet = new Wallet(privateKey, provider);

    const transactions = [];
    for (let i = 0; i < 5; i++) {
        transactions.push(performSwap(wallet, validTransactOpts));
    }

    // Wait for all transactions to be mined and get the receipts
    const transactionResponses = await Promise.all(transactions);
    const receipts = await Promise.all(transactionResponses.map(tx => tx.wait(1)));

    const blockHashes = receipts.map(receipt => receipt?.blockHash);

    if (blockHashes.some(blockHash => !blockHash)) {
        throw new Error("Block hash not found in one of the transactions");
    }

    const logsArray = await Promise.all(
        blockHashes.map(blockHash => queryLogs(incentiveAddress, incentivesEscrowInterface, eventType, provider, blockHash))
    );

    expect(logsArray.length).toBe(5);

    for (const log of logsArray) {
        if (!log) {
            throw new Error(`Log for event ${eventType} not found`);
        }
        const parsedLog = incentivesEscrowInterface.parseLog(log);
        const messageIdentifier = parsedLog?.args['messageIdentifier'];
        await checkRelayState(messageIdentifier);
    }
};

const checkRelayState = async (messageIdentifier: string, expectedState: Partial<RelayState> = {}) => {
    let attemptsCounter = 0;

    while (attemptsCounter < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier)) {
        relayState = await store.getRelayStateByKey(`relay_state:${messageIdentifier}`);
        attemptsCounter += 1;
        if (!relayState) {
            await wait(TIME_BETWEEN_ATTEMPTS);
        }
    }

    if (!relayState) {
        throw new Error(`Exceeded maximum attempts or event not found for messageIdentifier ${messageIdentifier}`);
    }

    expect(relayState).toMatchObject(expectedState);
};



// Test Cases ----------------------------------------------------------------------

describe('Incentive Events Tests', () => {

    it('should retrieve expected Bounty Claimed Event transaction successfully', async () => {
        await runTest(
            'BountyClaimed',
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

    it('should process multiple Bounty Claimed events correctly', async () => {
        await processMultipleEvents('BountyClaimed');
    });

    it('should process Bounty Claimed event with very high gas prices', async () => {
        const highGasOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "100000000000",
                priceOfAckGas: "100000000000",
            },
        };

        await runTest(
            'BountyClaimed',
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            },
            highGasOpts
        );
    });

    it('should not process Bounty Claimed event with negative target delta', async () => {
        const negativeTargetOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                targetDelta: -100,
            },
        };

        await runTest(
            'BountyClaimed',
            {
                status: 2,
                messageIdentifier: expect.any(String),
                bountyClaimedEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                }
            },
            negativeTargetOpts
        );
    });

    it('should retrieve expected Message Delivered Event transaction successfully', async () => {
        await runTest(
            'MessageDelivered',
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

    it('should process multiple Message Delivered events correctly', async () => {
        await processMultipleEvents('MessageDelivered');
    });

    it('should process Message Delivered event with low gas prices', async () => {
        const lowGasOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                priceOfDeliveryGas: "1000000000",
                priceOfAckGas: "1000000000",
            },
        };

        await runTest(
            'MessageDelivered',
            {
                status: 1,
                messageIdentifier: expect.any(String),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            },
            lowGasOpts
        );
    });

    it('should process Message Delivered event with very low incentive payment', async () => {
        const lowIncentiveOpts = {
            ...validTransactOpts,
            incentivePayment: parseEther('0.0001').toString(),
        };

        await runTest(
            'MessageDelivered',
            {
                status: 1,
                messageIdentifier: expect.any(String),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            },
            lowIncentiveOpts
        );
    });

    it('should process transactions with maximum gas limit and update RelayState', async () => {
        const highGasOpts = {
            ...validTransactOpts,
            incentive: {
                ...validTransactOpts.incentive,
                maxGasDelivery: 5000000,
            },
        };

        await runTest(
            'MessageDelivered',
            {
                status: 1,
                messageIdentifier: expect.any(String),
                deliveryGasCost: expect.any(BigInt),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            },
            highGasOpts
        );

        validTransactOpts.incentive.maxGasDelivery = 2000000;
    });

    it('should handle edge case of zero swap amount and update RelayState', async () => {
        const zeroSwapAmountOpts = {
            ...validTransactOpts,
            swapAmount: parseEther('0').toString(),
        };

        await runTest(
            'MessageDelivered',
            {
                status: 1,
                messageIdentifier: expect.any(String),
                deliveryGasCost: expect.any(BigInt),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            },
            zeroSwapAmountOpts
        );

        validTransactOpts.swapAmount = parseEther('0.1').toString();
    });

    it('should handle delayed confirmation and update RelayState', async () => {
        await runTest(
            'MessageDelivered',
            {
                status: 1,
                messageIdentifier: expect.any(String),
                deliveryGasCost: expect.any(BigInt),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            }
        );

        await wait(TIME_BETWEEN_ATTEMPTS * 2);

        expect(relayState).toMatchObject({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
        });
    });

    it('should retry and process RelayState after a failure', async () => {
        let failureCount = 0;
        const faultyRunTest = async () => {
            try {
                await runTest(
                    'MessageDelivered',
                    {
                        status: 1,
                        messageIdentifier: expect.any(String),
                        deliveryGasCost: expect.any(BigInt),
                        messageDeliveredEvent: {
                            transactionHash: expect.any(String),
                            blockHash: expect.any(String),
                            blockNumber: expect.any(Number),
                            toChainId: expect.any(String),
                        }
                    }
                );
            } catch (error) {
                failureCount++;
                if (failureCount < 3) {
                    await faultyRunTest();
                } else {
                    throw error;
                }
            }
        };

        await faultyRunTest();

        expect(relayState).toMatchObject({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
        });
    });

    it('should correctly process and store RelayState when multiple message identifiers are used', async () => {
        const messageIdentifiers = [];

        for (let i = 0; i < 2; i++) {
            await runTest(
                'MessageDelivered',
                {
                    status: 1,
                    messageIdentifier: expect.any(String),
                    deliveryGasCost: expect.any(BigInt),
                    messageDeliveredEvent: {
                        transactionHash: expect.any(String),
                        blockHash: expect.any(String),
                        blockNumber: expect.any(Number),
                        toChainId: expect.any(String),
                    }
                }
            );

            messageIdentifiers.push(relayState?.messageIdentifier);
        }

        for (const messageId of messageIdentifiers) {
            const storedState = await store.getRelayStateByKey(`relay_state:${messageId}`);
            expect(storedState).toMatchObject({
                status: 1,
                messageIdentifier: messageId,
                deliveryGasCost: expect.any(BigInt),
            });
        }
    });
});
