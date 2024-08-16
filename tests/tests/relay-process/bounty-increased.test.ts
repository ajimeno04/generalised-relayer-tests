import { Wallet, parseEther, JsonRpcProvider, parseUnits } from 'ethers6';
import { ATTEMPTS_MAXIMUM, TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../config/config';
import { Transaction, performSwap } from '../utils/perform-swap';
import { IMessageEscrowEvents__factory } from '../../contracts/factories/IMessageEscrowEvents__factory';
import { Store } from '@App/store/store.lib';
import { queryLogs } from '../utils/query-logs';
import { wait } from '@App/common/utils';
import { RelayState } from '@App/store/store.types';
import { IncentivizedMockEscrow__factory } from './../../contracts';

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

    return messageIdentifier;
};

describe('Bounty Increased Event Tests', () => {

    it('should perform a swap, increase the bounty, and verify the BountyIncreased event', async () => {
        const wallet = new Wallet(privateKey, provider);

        const messageIdentifier = await runTest(
            'BountyPlaced',
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

        const escrowContract = IncentivizedMockEscrow__factory.connect(incentiveAddress, wallet);
        const increaseBountyTx = await escrowContract.increaseBounty(
            messageIdentifier,
            parseUnits('50', 'gwei'),
            parseUnits('0', 'gwei'),
            { value: (50000000000n * 2000000n) }
        );
        await increaseBountyTx.wait(1);

        const log = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyIncreased', provider, undefined, messageIdentifier);
        expect(log).not.toBeNull();

        if (!log) {
            throw new Error("BountyIncreased event not found");
        }

        const parsedLog = incentivesEscrowInterface.parseLog(log);
        expect(parsedLog?.args['messageIdentifier']).toEqual(messageIdentifier);
        expect(parsedLog?.args['newDeliveryGasPrice']).toEqual(parseUnits('50', 'gwei'));
    });

    it('should handle multiple BountyIncreased events correctly', async () => {
        const wallet = new Wallet(privateKey, provider);
        const messageIdentifiers = [];

        for (let i = 0; i < 3; i++) {
            const messageIdentifier = await runTest(
                'BountyPlaced',
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

            messageIdentifiers.push(messageIdentifier);

            const escrowContract = IncentivizedMockEscrow__factory.connect(incentiveAddress, wallet);
            const increaseBountyTx = await escrowContract.increaseBounty(
                messageIdentifier,
                parseUnits('50', 'gwei'),
                parseUnits('0', 'gwei'),
                { value: (50000000000n * 2000000n) }
            );
            await increaseBountyTx.wait(1);
        }

        for (const messageIdentifier of messageIdentifiers) {
            const log = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyIncreased', provider);
            expect(log).not.toBeNull();

            if (!log) {
                throw new Error("BountyIncreased event not found");
            }

            const parsedLog = incentivesEscrowInterface.parseLog(log);
            expect(parsedLog?.args['messageIdentifier']).toEqual(messageIdentifier);
            expect(parsedLog?.args['newDeliveryGasPrice']).toEqual(parseUnits('50', 'gwei'));
        }
    });
});
