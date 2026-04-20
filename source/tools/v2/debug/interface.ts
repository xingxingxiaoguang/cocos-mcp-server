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

// ---- Subscription system ----

export type SubscriptionType = 'node_watch' | 'collision';

export interface NodeFilter {
    name?: string;
    path?: string;
    uuid?: string;
}

export interface SubscriptionOptions {
    type: SubscriptionType;
    properties?: string[];
    threshold?: number;
    interval?: number;
    duration?: number;
    nodeFilter?: NodeFilter;
    collisionEvents?: string[];
}

export interface SubscriptionEvent {
    subId: string;
    timestamp: string;
    type: SubscriptionType;
    nodeId?: string;
    data: Record<string, any>;
}

export interface SubscriptionInfo {
    id: string;
    type: SubscriptionType;
    status: 'active' | 'stopped' | 'error';
    options: SubscriptionOptions;
    createdAt: string;
    eventCount: number;
}
