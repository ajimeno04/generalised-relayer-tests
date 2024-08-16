import { JsonRpcProvider, Wallet } from 'ethers6';
import { performSwap } from '../utils/perform-swap';
import { WebSocket } from 'ws';
import { TIME_BETWEEN_ATTEMPTS, loadConfig } from '../../config/config';
import dotenv from 'dotenv';

dotenv.config();

jest.setTimeout(30000000);

let provider: JsonRpcProvider;
let wallet: Wallet;
let wsClient: WebSocket;

const config = loadConfig('./tests/config/config.test.yaml');
const privateKey = config.ambs[0]?.privateKey;

if (!privateKey) {
    throw new Error('Private key not found');
}

const relayerPort = process.env['RELAYER_PORT'] || '3001';


beforeAll(async () => {
    provider = new JsonRpcProvider(config.chains[0]?.rpc);
    wallet = new Wallet(privateKey, provider);

    wsClient = new WebSocket('ws://localhost:${relayerPort}`');
});

afterAll(() => {
    wsClient.close();
});

const subscribeToMonitor = (): Promise<void> => {
    return new Promise((resolve, reject) => {
        wsClient.on('open', () => {
            wsClient.send(JSON.stringify({ event: 'subscribe', data: { event: 'monitor' } }));
            resolve();
        });

        wsClient.on('error', (error: any) => {
            reject(error);
        });
    });
};

const waitForMonitorEvent = (): Promise<{ blockNumber: number; blockHash: string; timestamp: number }> => {
    return new Promise((resolve, reject) => {
        wsClient.on('message', (data: { toString: () => string; }) => {
            const message = JSON.parse(data.toString());
            if (message.event === 'monitor') {
                resolve(message.data);
            }
        });

        wsClient.on('error', (error: any) => {
            reject(error);
        });
    });
};

describe('Monitor Service Integration Tests', () => {
    it('should retrieve the latest block and broadcast its status', async () => {
        await subscribeToMonitor();

        const block = await provider.getBlock('latest');
        expect(block).not.toBeNull();

        if (!block || !block.number || !block.hash || !block.timestamp) {
            throw new Error('Block data is incomplete or null');
        }

        const monitorStatus = await waitForMonitorEvent();

        expect(monitorStatus.blockNumber).toBe(block.number);
        expect(monitorStatus.blockHash).toBe(block.hash);
        expect(monitorStatus.timestamp).toBe(block.timestamp);
    });

    it('should update monitor status after performing a transaction', async () => {
        const tx = await performSwap(wallet, {
            direction: true,
            swapAmount: '1000000000000000000',
            incentivePayment: '500000000000000000',
            incentive: {
                maxGasDelivery: 2000000,
                maxGasAck: 2000000,
                refundGasTo: wallet.address,
                priceOfDeliveryGas: '50000000000',
                priceOfAckGas: '50000000000',
                targetDelta: 0,
            },
        });
        await tx.wait(TIME_BETWEEN_ATTEMPTS);

        const newBlock = await provider.getBlock('latest');
        expect(newBlock).not.toBeNull();

        if (!newBlock || !newBlock.number || !newBlock.hash || !newBlock.timestamp) {
            throw new Error('Block data is incomplete or null');
        }

        const monitorStatus = await waitForMonitorEvent();

        expect(monitorStatus.blockNumber).toBe(newBlock.number);
        expect(monitorStatus.blockHash).toBe(newBlock.hash);
        expect(monitorStatus.timestamp).toBe(newBlock.timestamp);
    });

    it('should handle multiple transactions and broadcast the latest block status', async () => {
        const tx1 = await performSwap(wallet, {
            direction: true,
            swapAmount: '1000000000000000000',
            incentivePayment: '500000000000000000',
            incentive: {
                maxGasDelivery: 2000000,
                maxGasAck: 2000000,
                refundGasTo: wallet.address,
                priceOfDeliveryGas: '50000000000',
                priceOfAckGas: '50000000000',
                targetDelta: 0,
            },
        });
        await tx1.wait(1);

        const tx2 = await performSwap(wallet, {
            direction: true,
            swapAmount: '2000000000000000000',
            incentivePayment: '1000000000000000000',
            incentive: {
                maxGasDelivery: 3000000,
                maxGasAck: 3000000,
                refundGasTo: wallet.address,
                priceOfDeliveryGas: '60000000000',
                priceOfAckGas: '60000000000',
                targetDelta: 0,
            },
        });
        await tx2.wait(1);

        const newBlock = await provider.getBlock('latest');
        expect(newBlock).not.toBeNull();

        if (!newBlock || !newBlock.number || !newBlock.hash || !newBlock.timestamp) {
            throw new Error('Block data is incomplete or null');
        }

        const monitorStatus = await waitForMonitorEvent();

        expect(monitorStatus.blockNumber).toBe(newBlock.number);
        expect(monitorStatus.blockHash).toBe(newBlock.hash);
        expect(monitorStatus.timestamp).toBe(newBlock.timestamp);
    });
});
