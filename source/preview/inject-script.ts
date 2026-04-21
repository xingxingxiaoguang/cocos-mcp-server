import * as fs from 'fs';
import * as path from 'path';

let agentSource: string | null = null;

function loadAgentSource(): string {
    if (agentSource) return agentSource;

    const candidates = [
        path.join(__dirname, 'agent.js'),
        path.join(__dirname, '..', '..', 'source', 'preview', 'agent.js'),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            agentSource = fs.readFileSync(p, 'utf8');
            return agentSource;
        }
    }

    throw new Error('Runtime agent script not found');
}

/** Return the agent JS source with the port placeholder replaced. */
export function getAgentScript(port: number): string {
    return loadAgentSource().replace(/__PORT__/g, String(port));
}

/** Return a full URL for loading the agent script from the MCP server. */
export function getAgentScriptUrl(port: number): string {
    return `http://127.0.0.1:${port}/runtime-agent.js`;
}
