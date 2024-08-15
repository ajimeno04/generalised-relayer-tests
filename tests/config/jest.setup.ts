import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import crossSpawn from 'cross-spawn';
import { deployFullEnvironment } from './deployment/deployment';
import { fundWallets } from './deployment/fund-wallets';
import { generateConfig } from './config';


async function startAnvil(port: string, chainId: string, pids: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        const anvil = spawn('anvil', ['--port', port, '--chain-id', chainId, '--block-time', '2'], { stdio: 'inherit' });

        if (anvil.pid) {
            pids.push(anvil.pid.toString());
        }

        anvil.stdout?.on('data', (data) => {
            console.log(data);
        });

        anvil.stderr?.on('data', (data) => {
            console.error(`Anvil stderr: ${data}`);
        });

        anvil.on('error', (error) => {
            console.error(`Failed to start Anvil on port ${port} with chain-id ${chainId}: ${error}`);
            reject(error);
        });

        anvil.on('close', (code) => {
            console.log(`Anvil process exited with code ${code}`);
        });

        // Give some time to ensure Anvil has started properly
        setTimeout(() => {
            resolve();
        }, 5000);
    });
}
async function tryDeployFullEnvironment(retries: number): Promise<string[]> {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const result = await deployFullEnvironment();
            console.log("Result of deployment:", result);
            return result;
        } catch (error) {
            console.error(`Error during deployment (attempt ${attempt} of ${retries}):`, error);
            if (attempt === retries) {
                throw error;
            }
        }
    }
    throw new Error('Deployment failed after multiple attempts');
}

export default async function globalSetup() {
    const pids: string[] = [];

    try {
        await startAnvil('8545', '1', pids);
        await startAnvil('8546', '2', pids);

        // Try to deploy up to 3 times if an error occurs
        const [escrowAddress, vaultAAddress] = await tryDeployFullEnvironment(10);


        if (escrowAddress && vaultAAddress) {
            generateConfig(escrowAddress, vaultAAddress);
            await fundWallets();
        } else {
            throw new Error('Deployment failed');
        }

        //The relayer port must be different for the github actions proccess
        await new Promise<void>((resolve) => {
            const relayer = crossSpawn('sh', ['-c', 'NODE_ENV=test CONFIG_FILE_PATH=./tests/config/config.test.yaml RELAYER_PORT=3001 nest start'], {
                stdio: 'inherit'
            });

            if (relayer.pid) {
                pids.push(relayer.pid.toString());
            }
            // Give some time to ensure the relayer has started properly
            setTimeout(() => {
                resolve();
            }, 30000);
        });

        await fs.writeFile('./tests/config/pids.json', JSON.stringify(pids, null, 2));

    } catch (error) {
        console.error('Global setup failed:', error);
        throw error;
    }
}
