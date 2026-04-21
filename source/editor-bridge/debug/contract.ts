import type {
    ConsoleMessage,
    EditorEnvironmentInfo,
    TraceSampleOptions,
    TraceOptions,
    CollisionWaitOptions,
} from '../../capabilities/debug/interface';

// ---------------------------------------------------------------------------
// DebugBridgeDriver — 调试领域底层 I/O 抽象
// ---------------------------------------------------------------------------

export interface DebugBridgeDriver {
    // ---- 生命周期 ----
    startConsoleCapture(): void;
    stopConsoleCapture(): void;

    // ---- Console 日志缓冲（有状态） ----
    getConsoleMessages(limit: number, filter?: string): ConsoleMessage[];
    clearConsoleMessages(): void;

    // ---- Editor Console IPC ----
    sendClearConsole(): void;

    // ---- 项目日志文件 I/O ----
    findLogFilePath(): string | null;
    readLogFile(logFilePath: string): string[];

    // ---- Editor IPC ----
    executeInEditor(script: string): Promise<any>;
    getEditorInfo(): EditorEnvironmentInfo;
    checkMissingAssets(): Promise<MissingAssetsResult | null>;
    getPerformanceStats(): Promise<PerformanceStatsResult | null>;

    // ---- RuntimeBridge 代理 ----
    isRuntimeConnected(): boolean;
    getRuntimeLogs(limit: number, level: string): ConsoleMessage[];
    executeInRuntime(script: string): Promise<any>;
    getRuntimeSummary(): Promise<any>;
    traceSample(options: TraceSampleOptions): Promise<any>;
    trace(options: TraceOptions): Promise<any>;
    traceCollisionWait(options: CollisionWaitOptions): Promise<any>;
    getGameState(): Promise<any>;
}

// ---------------------------------------------------------------------------
// 底层结果类型
// ---------------------------------------------------------------------------

export interface MissingAssetsResult {
    missing: any[];
}

export interface PerformanceStatsResult {
    nodeCount: number;
    componentCount: number;
    [key: string]: any;
}
