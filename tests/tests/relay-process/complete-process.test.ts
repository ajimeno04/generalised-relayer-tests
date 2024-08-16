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

describe('Complete Proccess Tests', () => {

    it('should handle a mix of different events in one batch', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const transactions: any[] = [];
        const blockHashes: string[] = [];

        for (let i = 0; i < 5; i++) {
            const tx = await performSwap(wallet, validTransactOpts);
            const receipt = await tx.wait(1);
            const blockHash = receipt?.blockHash;

            if (!blockHash) {
                throw new Error("Block hash not found");
            }

            transactions.push(tx);
            blockHashes.push(blockHash);
        }

        const logs = await Promise.all(
            blockHashes.map(blockHash => queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyPlaced', provider, blockHash))
        );

        logs.forEach((log, index) => {
            expect(log).not.toBeNull();
            if (!log) {
                throw new Error(`Log not found for blockHash ${blockHashes[index]}`);
            }
        });

        const messageIdentifiers = logs.map(log => {
            if (log) {
                return incentivesEscrowInterface.parseLog(log)?.args['messageIdentifier'];
            }
        });

        for (const messageIdentifier of messageIdentifiers) {
            let attempts = 0;
            let relayState: Partial<RelayState> | null = null;

            while (attempts < ATTEMPTS_MAXIMUM && (!relayState || relayState.messageIdentifier !== messageIdentifier || relayState.status !== 2)) {
                relayState = await store.getRelayStateByKey('relay_state:' + messageIdentifier);
                attempts += 1;

                if (!relayState) {
                    await wait(TIME_BETWEEN_ATTEMPTS);
                }
            }

            if (!relayState) {
                throw new Error(`Exceeded maximum attempts or bounty not found for messageIdentifier ${messageIdentifier}`);
            }

            expect(relayState.messageIdentifier).toEqual(messageIdentifier);
            expect(relayState.status).toEqual(2);
            expect(relayState.bountyPlacedEvent).not.toBeNull();
            expect(relayState.messageDeliveredEvent).not.toBeNull();
            expect(relayState.bountyClaimedEvent).not.toBeNull();
        }
    });


    it('should process the complete flow of events (BountyPlaced, MessageDelivered, BountyClaimed)', async () => {
        const wallet = new Wallet(privateKey, new JsonRpcProvider(config.chains[0]?.rpc));

        const tx1 = await performSwap(wallet, validTransactOpts);
        const receipt1 = await tx1.wait(1);
        const blockHash1 = receipt1?.blockHash;
        if (!blockHash1) {
            throw new Error("Block number not found");
        }

        const log1 = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyPlaced', provider, blockHash1);
        if (!log1) {
            throw new Error("Log not found");
        }
        const parsedLog1 = incentivesEscrowInterface.parseLog(log1);
        const messageIdentifier = parsedLog1?.args['messageIdentifier'];

        const log2 = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyClaimed', provider, undefined, messageIdentifier);
        const log3 = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'MessageDelivered', provider, undefined, messageIdentifier);
        const log4 = await queryLogs(incentiveAddress, incentivesEscrowInterface, 'BountyIncreased', provider, undefined, messageIdentifier);


        expect(log1).not.toBeNull();
        expect(log2).not.toBeNull();
        expect(log3).not.toBeNull();
        expect(log4).not.toBeNull();

        if (!log1 || !log2 || !log3 || !log4) {
            throw new Error("Log not found");
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
        expect(relayState.status).toEqual(2);
        expect(relayState.bountyPlacedEvent).not.toBeNull();
        expect(relayState.messageDeliveredEvent).not.toBeNull();
        expect(relayState.bountyClaimedEvent).not.toBeNull();

    });
});
