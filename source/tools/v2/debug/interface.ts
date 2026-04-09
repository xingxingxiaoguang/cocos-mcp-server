export interface ConsoleMessage {
    timestamp: string;
    type: 'log' | 'warn' | 'error' | 'info';
    content: string;
    source?: string;
    stack?: string;
}

export interface PerformanceStats {
    nodeCount: number | null;
    componentCount: number | null;
    drawCalls: number | null;
    triangles: number | null;
    memory: Record<string, any>;
    note?: string;
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
