export interface ConsoleMessage {
    timestamp: string;
    type: 'log' | 'warn' | 'error' | 'info';
    content: string;
    source?: string;
    stack?: string;
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
    errorCount: number;
    uptime: number;
}
