import { exec } from 'child_process';
import util from 'util';
import { promises as fs } from 'fs';

const execPromise = util.promisify(exec);

export default async function globalTeardown() {
    if (process.env['JEST_WATCH_MODE']) {
        console.log('In watch mode, skipping global teardown...');
        return;
    }

    console.log('Running global teardown...');

    try {
        const pidsData = await fs.readFile('./tests/config/pids.json', 'utf-8');
        const pids: string[] = JSON.parse(pidsData);
        console.log('PIDs to stop:', pids);

        for (const pid of pids) {
            try {
                await execPromise(`kill ${pid}`);
                console.log(`Process with PID ${pid} stopped.`);
            } catch (error) {
                console.error(`Failed to stop process with PID ${pid}:`, error);
            }
        }

        try {
            await execPromise(`pkill pnpm`);
            console.log('Relayer process stopped.');
        } catch (error) {
            console.error('Failed to stop relayer process:', error);
        }

        try {
            await fs.unlink('./tests/config/pids.json');
            console.log('Deleted pids.json');
        } catch (error) {
            if (error !== 'ENOENT') {
                console.error('Failed to delete pids.json:', error);
            }
        }

        try {
            await fs.unlink('./tests/config/config.test.yaml');
            console.log('Deleted config.test.yaml');
        } catch (error) {
            if (error !== 'ENOENT') {
                console.error('Failed to delete config.test.yaml:', error);
            }
        }

    } catch (error) {
        console.error('Failed to process teardown:', error);
    } finally {
        process.exit(0);
    }
}
