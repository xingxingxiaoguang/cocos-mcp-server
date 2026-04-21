import type {
    DebugCapability,
    QueryLogsInput,
    QueryLogsResult,
    SearchLogsResult,
    ExecuteResult,
    EditorEnvironmentInfo,
    ValidateSceneInput,
    ValidationResult,
    ValidationIssue,
    RuntimeSummary,
    TraceSampleOptions,
    TraceOptions,
    CollisionWaitOptions,
    GameStateInfo,
} from './interface';
import type { DebugBridgeDriver } from '../../editor-bridge/debug/contract';

const PERSIST_WARNING =
    'Runtime edits made through debug_execute are not persisted by scene_save. Use component_modify for persistent changes.';

export class DebugService implements DebugCapability {
    constructor(private readonly driver: DebugBridgeDriver) {
        this.driver.startConsoleCapture();
    }

    dispose(): void {
        this.driver.stopConsoleCapture();
    }

    // =========================================================================
    // Logs
    // =========================================================================

    async queryLogs(input: QueryLogsInput): Promise<QueryLogsResult> {
        const source = input.source || 'all';
        const limit = input.limit || 100;
        const filter = input.filter;
        const level = input.level || 'all';

        if (source === 'console') return this.getConsoleLogs(limit, filter || level);
        if (source === 'file') return this.getProjectLogs(limit, filter, level);
        if (source === 'runtime') return this.getRuntimeLogs(limit, level);

        const consoleLogs = this.getConsoleLogs(limit, filter || level);
        const fileLogs = this.getProjectLogs(limit, filter, level);
        const runtimeLogs = this.getRuntimeLogs(limit, level);

        const merged: any[] = [];
        if (consoleLogs.logs.length) {
            merged.push(...consoleLogs.logs.map((log: any) => ({ ...log, source: log.source || 'console' })));
        }
        if (fileLogs.logs.length) {
            merged.push(...fileLogs.logs.map((log: any) =>
                typeof log === 'string' ? { content: log, source: 'file' } : { ...log, source: 'file' }
            ));
        }
        if (runtimeLogs.logs.length) {
            merged.push(...runtimeLogs.logs);
        }

        return {
            total: merged.length,
            returned: merged.length,
            logs: merged,
            sources: {
                console: consoleLogs.returned,
                file: fileLogs.returned,
                runtime: runtimeLogs.returned,
            },
        };
    }

    async searchLogs(pattern: string, maxResults: number = 20, contextLines: number = 2): Promise<SearchLogsResult> {
        const logFilePath = this.driver.findLogFilePath();
        if (!logFilePath) throw new Error('Project log file not found');

        const logLines = this.driver.readLogFile(logFilePath);

        let regex: RegExp;
        try {
            regex = new RegExp(pattern, 'gi');
        } catch {
            regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
        }

        const matches: SearchLogsResult['matches'] = [];
        let resultCount = 0;

        for (let i = 0; i < logLines.length && resultCount < maxResults; i++) {
            if (regex.test(logLines[i])) {
                const contextStart = Math.max(0, i - contextLines);
                const contextEnd = Math.min(logLines.length - 1, i + contextLines);
                const context = [];
                for (let j = contextStart; j <= contextEnd; j++) {
                    context.push({ lineNumber: j + 1, content: logLines[j], isMatch: j === i });
                }
                matches.push({ lineNumber: i + 1, matchedLine: logLines[i], context });
                resultCount++;
                regex.lastIndex = 0;
            }
        }

        return { pattern, totalMatches: matches.length, maxResults, contextLines, logFilePath, matches };
    }

    async clearConsole(): Promise<void> {
        this.driver.clearConsoleMessages();
        this.driver.sendClearConsole();
    }

    // =========================================================================
    // Execute
    // =========================================================================

    async executeScript(script: string, target: 'editor' | 'runtime' = 'editor'): Promise<ExecuteResult> {
        if (target === 'runtime') {
            if (!this.driver.isRuntimeConnected()) {
                throw new Error(
                    'Runtime agent not connected. Load the agent in Preview first: '
                    + 'in DevTools console run: const s=document.createElement("script");'
                    + 's.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);'
                );
            }
            const data = await this.driver.executeInRuntime(script);
            return { result: data };
        }

        return this.wrapEditorResult(await this.driver.executeInEditor(script));
    }

    // =========================================================================
    // Inspect
    // =========================================================================

    getEditorEnvironment(): EditorEnvironmentInfo {
        return this.driver.getEditorInfo();
    }

    async validateScene(input: ValidateSceneInput): Promise<ValidationResult> {
        const issues: ValidationIssue[] = [];

        if (input.checkMissingAssets !== false) {
            const assetCheck = await this.driver.checkMissingAssets();
            if (assetCheck?.missing?.length) {
                issues.push({
                    type: 'error',
                    category: 'assets',
                    message: `Found ${assetCheck.missing.length} missing asset references`,
                    details: assetCheck.missing,
                });
            }
        }

        if (input.checkPerformance !== false) {
            const perf = await this.driver.getPerformanceStats();
            if (perf) {
                if (perf.nodeCount > 1000) {
                    issues.push({
                        type: 'warning',
                        category: 'performance',
                        message: `High node count: ${perf.nodeCount} nodes (recommended < 1000)`,
                        suggestion: 'Consider using object pooling or scene optimization',
                    });
                }
                if (perf.componentCount > 5000) {
                    issues.push({
                        type: 'warning',
                        category: 'performance',
                        message: `High component count: ${perf.componentCount} components`,
                        suggestion: 'Review if all components are necessary',
                    });
                }
            }
        }

        return { valid: issues.length === 0, issueCount: issues.length, issues };
    }

    async getRuntimeSummary(): Promise<RuntimeSummary> {
        if (!this.driver.isRuntimeConnected()) {
            throw new Error(
                'Runtime agent not connected. Load the agent in Preview first: '
                + 'in DevTools console run: const s=document.createElement("script");'
                + 's.src="http://127.0.0.1:<port>/runtime-agent.js";document.head.appendChild(s);'
            );
        }
        return this.driver.getRuntimeSummary();
    }

    // =========================================================================
    // Trace
    // =========================================================================

    async traceSample(options: TraceSampleOptions): Promise<any> {
        this.ensureRuntime();
        return this.driver.traceSample(options);
    }

    async trace(options: TraceOptions): Promise<any> {
        this.ensureRuntime();
        return this.driver.trace(options);
    }

    async traceCollisionWait(options: CollisionWaitOptions): Promise<any> {
        this.ensureRuntime();
        return this.driver.traceCollisionWait(options);
    }

    async getGameState(): Promise<GameStateInfo> {
        this.ensureRuntime();
        return this.driver.getGameState();
    }

    // =========================================================================
    // 内部辅助
    // =========================================================================

    private getConsoleLogs(limit: number, filter: string): QueryLogsResult {
        const total = this.driver.getConsoleMessages(Number.MAX_SAFE_INTEGER).length;
        const logs = this.driver.getConsoleMessages(limit, filter);

        if (logs.length === 0) {
            const fallback = this.getProjectLogs(limit, undefined, filter);
            if (fallback.returned > 0) {
                return { ...fallback, source: 'project_log_fallback', note: 'Console capture not available, showing project log instead' };
            }
        }

        return { total, returned: logs.length, logs };
    }

    private getProjectLogs(limit: number, filterKeyword?: string, logLevel: string = 'all'): QueryLogsResult {
        const logFilePath = this.driver.findLogFilePath();
        if (!logFilePath) return { total: 0, returned: 0, logs: [] };

        try {
            const allLines = this.driver.readLogFile(logFilePath);
            const recentLines = allLines.slice(-limit);

            const normalizedLevel = (logLevel || 'all').toLowerCase();
            let filteredLines = recentLines;
            if (normalizedLevel !== 'all') {
                filteredLines = filteredLines.filter(line =>
                    line.toLowerCase().includes(`[${normalizedLevel}]`) || line.toLowerCase().includes(normalizedLevel)
                );
            }
            if (filterKeyword) {
                filteredLines = filteredLines.filter(line =>
                    line.toLowerCase().includes(filterKeyword.toLowerCase())
                );
            }

            return { total: allLines.length, returned: filteredLines.length, logs: filteredLines };
        } catch {
            return { total: 0, returned: 0, logs: [] };
        }
    }

    private getRuntimeLogs(limit: number, level: string): QueryLogsResult {
        if (!this.driver.isRuntimeConnected()) {
            return { total: 0, returned: 0, logs: [], note: 'Runtime agent not connected' };
        }
        const logs = this.driver.getRuntimeLogs(limit, level);
        return { total: logs.length, returned: logs.length, logs };
    }

    private wrapEditorResult(result: any): ExecuteResult {
        if (result === undefined || result === null) {
            throw new Error('evalScript method not found. Ensure the plugin scene script is loaded.');
        }
        if (result && typeof result === 'object' && 'success' in result) {
            if (!result.success) throw new Error(result.error || 'Script execution failed');
            return {
                result: result.data ?? result.result,
                warning: result.warning
                    ? `${result.warning}; ${PERSIST_WARNING}`
                    : PERSIST_WARNING,
            };
        }
        return { result, warning: PERSIST_WARNING };
    }

    private ensureRuntime(): void {
        if (!this.driver.isRuntimeConnected()) {
            throw new Error('Runtime agent not connected. Load the agent in Preview first.');
        }
    }
}
