import { JsonRpcProvider, Log } from "ethers6";
import { config } from "../../config/config";
import { wait } from "@App/common/utils";

const retryInterval = config.global.getter.retryInterval;

export async function queryLogs(
    incentiveAddress: string,
    incentivesEscrowInterface: any,
    eventName: string,
    provider: JsonRpcProvider,
    blockHash?: string,
    messageIdentifier?: string
): Promise<Log | undefined> {
    if (retryInterval === undefined) {
        throw new Error('Retry interval is not defined');
    }

    const eventTopic = incentivesEscrowInterface.getEvent(eventName).topicHash;
    const filter: any = {
        address: incentiveAddress,
        topics: [eventTopic],
    };

    if (blockHash) {
        return await queryLogsByBlock(filter, provider, blockHash);
    }

    if (messageIdentifier) {
        return await queryLogsByMessageIdentifier(filter, provider, incentivesEscrowInterface, messageIdentifier);
    }

    return undefined;
}

async function queryLogsByBlock(filter: any, provider: JsonRpcProvider, blockHash: string): Promise<Log | undefined> {
    filter.blockHash = blockHash;

    while (true) {
        const logs = await provider.getLogs(filter);
        if (logs.length > 0) {
            return logs[0];
        }
        await wait(retryInterval);
    }
}

async function queryLogsByMessageIdentifier(
    filter: any,
    provider: JsonRpcProvider,
    incentivesEscrowInterface: any,
    messageIdentifier: string
): Promise<Log | undefined> {
    while (true) {
        try {
            const logs = await provider.getLogs(filter);

            for (const log of logs) {
                const parsedLog = incentivesEscrowInterface.parseLog(log);
                if (parsedLog?.args['messageIdentifier'] === messageIdentifier) {
                    return log;
                }
            }
        } catch (error) {
            // Log error or handle it if necessary
        }
        await wait(retryInterval);
    }
}
