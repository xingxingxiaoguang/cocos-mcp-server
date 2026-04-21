// ---------------------------------------------------------------------------
// DebugCapability — 调试领域能力接口
// ---------------------------------------------------------------------------

export interface DebugCapability {
    // Logs
    queryLogs(input: QueryLogsInput): Promise<QueryLogsResult>;
    searchLogs(pattern: string, maxResults?: number, contextLines?: number): Promise<SearchLogsResult>;
    clearConsole(): Promise<void>;

    // Execute
    executeScript(script: string, target?: 'editor' | 'runtime'): Promise<ExecuteResult>;

    // Inspect
    getEditorEnvironment(): EditorEnvironmentInfo;
    validateScene(input: ValidateSceneInput): Promise<ValidationResult>;
    getRuntimeSummary(): Promise<RuntimeSummary>;

    // Trace
    traceSample(options: TraceSampleOptions): Promise<any>;
    trace(options: TraceOptions): Promise<any>;
    traceCollisionWait(options: CollisionWaitOptions): Promise<any>;
    getGameState(): Promise<GameStateInfo>;

    // Lifecycle
    dispose(): void;
}

// ---------------------------------------------------------------------------
// 基础领域类型（迁移自 tools/v2/debug/interface.ts）
// ---------------------------------------------------------------------------

export interface ConsoleMessage {
    timestamp: string;
    type: 'log' | 'warn' | 'error' | 'info';
    content: string;
    source?: string;
    stack?: string;
}

export interface NodeFilter {
    name?: string;
    path?: string;
    uuid?: string;
}

export interface ValidationIssue {
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    details?: any;
    suggestion?: string;
}

export interface ValidationResult {
    valid: boolean;
    issueCount: number;
    issues: ValidationIssue[];
}

export interface RuntimeSummary {
    fps: number;
    drawCalls: number;
    triangles: number;
    nodeCount: number;
    activeNodeCount: number;
    componentCount: number;
    currentScene: string;
    memory: { jsHeapUsed: number; jsHeapTotal: number };
    physics: {
        enabled: boolean;
        type: '2D' | '3D' | null;
        gravity: { x: number; y: number; z: number } | null;
        ptmRatio?: number;
        allowSleep?: boolean;
        fixedTimeStep?: number;
        velocityIterations?: number;
        positionIterations?: number;
    };
    errorCount: number;
    uptime: number;
}

// ---------------------------------------------------------------------------
// Trace 系统类型
// ---------------------------------------------------------------------------

export type TriggerType = 'keyboard' | 'method' | 'property' | 'script';

export interface TriggerAction {
    type: TriggerType;
    key?: string;
    keyCode?: number;
    componentType?: string;
    method?: string;
    args?: any[];
    property?: string;
    value?: any;
    code?: string;
}

export interface TraceSampleOptions {
    nodeFilter: NodeFilter;
    properties?: string[];
    frames?: number;
    interval?: number;
}

export interface TraceOptions {
    nodeFilter: NodeFilter;
    properties?: string[];
    trigger: TriggerAction;
    preFrames?: number;
    postFrames?: number;
    interval?: number;
}

export interface CollisionWaitOptions {
    nodeFilter: NodeFilter;
    collisionEvents?: string[];
    timeout?: number;
}

export interface SamplePoint {
    frame: number;
    timestamp: number;
    data: Record<string, any>;
}

export interface TraceAnalysis {
    changedProperties: string[];
    maxDelta: Record<string, number>;
    trend: Record<string, string>;
    summary: string;
}

export interface GameStateInfo {
    paused: boolean;
    fps: number;
    deltaTime: number;
    sceneName: string | null;
    nodeCount: number;
    physics: {
        enabled: boolean;
        type: '2D' | '3D' | null;
        gravity: { x: number; y: number; z: number } | null;
    } | null;
}

// ---------------------------------------------------------------------------
// Capability 方法输入/输出类型
// ---------------------------------------------------------------------------

export interface QueryLogsInput {
    source?: 'console' | 'file' | 'runtime' | 'all';
    limit?: number;
    filter?: string;
    level?: string;
}

export interface QueryLogsResult {
    total: number;
    returned: number;
    logs: any[];
    sources?: { console: number; file: number; runtime: number };
    source?: string;
    note?: string;
}

export interface SearchLogsResult {
    pattern: string;
    totalMatches: number;
    maxResults: number;
    contextLines: number;
    logFilePath: string;
    matches: SearchMatch[];
}

export interface SearchMatch {
    lineNumber: number;
    matchedLine: string;
    context: SearchContextLine[];
}

export interface SearchContextLine {
    lineNumber: number;
    content: string;
    isMatch: boolean;
}

export interface ExecuteResult {
    result?: any;
    warning?: string;
}

export interface EditorEnvironmentInfo {
    editor: {
        version: string;
        cocosVersion: string;
        platform: string;
        arch: string;
        nodeVersion: string;
    };
    project: { name: string; path: string; uuid: string };
    memory: NodeJS.MemoryUsage;
    uptime: number;
}

export interface ValidateSceneInput {
    checkMissingAssets?: boolean;
    checkPerformance?: boolean;
}
