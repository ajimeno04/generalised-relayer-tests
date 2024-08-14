import { Wallet, parseEther, JsonRpcProvider } from 'ethers6';
import { ATTEMPTS_MAXIMUM, TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../../config/config';
import { Transaction, performSwap } from '../../utils/perform-swap';
import { Store } from '@App/store/store.lib';
import { wait } from '@App/common/utils';
import { RelayState } from '@App/store/store.types';
import { IMessageEscrowEvents__factory } from '@App/contracts/factories/IMessageEscrowEvents__factory';
import { queryLogs } from '../../utils/query-logs';

jest.setTimeout(30000000);

let relayState: Partial<RelayState> | null;
let attemptsCounter = 0;
let store: Store;

const config = loadConfig('./tests/config/config.test.yaml');

beforeAll(async () => {
    store = new Store();
});

beforeEach(() => {
    relayState = null;
    attemptsCounter = 0;
});

afterAll(() => {
    store.quit();
});

const incentivesEscrowInterface = IMessageEscrowEvents__factory.createInterface();
const incentiveAddress = config.chains[0]?.mock?.incentivesAddress;
const privateKey = config.ambs[0]?.privateKey;
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

const runTest = async (expectedStructure: Partial<RelayState>) => {
    const wallet = new Wallet(privateKey, provider);
    const tx = await performSwap(wallet, validTransactOpts);
    const receipt = await tx.wait(1);

    if (!receipt?.blockHash) {
        throw new Error("Transaction receipt or block hash not found");
    }


    const log = await queryLogs(incentiveAddress, incentivesEscrowInterface.getEvent('BountyPlaced').topicHash, provider, receipt.blockHash);

    if (log) {
        const parsedLog = incentivesEscrowInterface.parseLog(log);
        const messageIdentifier = parsedLog?.args['messageIdentifier'];

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

describe('Submitter and Wallet Worker Global Integration Tests', () => {

    it('should process and store RelayState for a single transaction', async () => {
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
    });

    it('should process and store RelayState for multiple transactions', async () => {
        for (let i = 0; i < 3; i++) {
            await runTest({
                status: 1,
                messageIdentifier: expect.any(String),
                deliveryGasCost: expect.any(BigInt),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            });
        }
    });

    it('should handle delayed confirmation and update RelayState', async () => {
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
    });

    it('should retry and process RelayState after a failure', async () => {
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
    });
    it('should process transactions with maximum gas limit and update RelayState', async () => {
        validTransactOpts.incentive.maxGasDelivery = 5000000;
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
        validTransactOpts.incentive.maxGasDelivery = 2000000;
    });

    it('should handle edge case of zero swap amount and update RelayState', async () => {
        validTransactOpts.swapAmount = parseEther('0').toString();
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
        validTransactOpts.swapAmount = parseEther('0.1').toString();
    });

    it('should process transactions with very high gas prices and update RelayState', async () => {
        validTransactOpts.incentive.priceOfDeliveryGas = "100000000000";
        await runTest({
            status: 1,
            messageIdentifier: expect.any(String),
            deliveryGasCost: expect.any(BigInt),
            messageDeliveredEvent: {
                transactionHash: expect.any(String),
                blockHash: expect.any(String),
                blockNumber: expect.any(Number),
                toChainId: expect.any(String),
            }
        });
        validTransactOpts.incentive.priceOfDeliveryGas = "50000000000";
    });

    it('should correctly process and store RelayState when multiple message identifiers are used', async () => {
        for (let i = 0; i < 2; i++) {
            await runTest({
                status: 1,
                messageIdentifier: expect.any(String),
                deliveryGasCost: expect.any(BigInt),
                messageDeliveredEvent: {
                    transactionHash: expect.any(String),
                    blockHash: expect.any(String),
                    blockNumber: expect.any(Number),
                    toChainId: expect.any(String),
                }
            });
        }
    });
});
