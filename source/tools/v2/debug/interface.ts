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

// ---- Trace system ----

export type TriggerType = 'keyboard' | 'method' | 'property' | 'script';

export interface TriggerAction {
    type: TriggerType;
    key?: string;              // for keyboard: e.g. "ArrowUp", "Space"
    keyCode?: number;          // for keyboard: numeric keyCode
    componentType?: string;    // for method/property: e.g. "cc.RigidBody2D"
    method?: string;           // for method: method name to call
    args?: any[];              // for method: arguments
    property?: string;         // for property: property name to set
    value?: any;               // for property: value to set
    code?: string;             // for script: JS code
}

export interface TraceSampleOptions {
    nodeFilter: NodeFilter;
    properties?: string[];
    frames?: number;       // sample count, default 5
    interval?: number;     // ms between samples, default 100
}

export interface TraceOptions {
    nodeFilter: NodeFilter;
    properties?: string[];
    trigger: TriggerAction;
    preFrames?: number;    // default 3
    postFrames?: number;   // default 10
    interval?: number;     // default 100
}

export interface CollisionWaitOptions {
    nodeFilter: NodeFilter;
    collisionEvents?: string[]; // default ["onCollisionEnter"]
    timeout?: number;       // seconds, default 5
}

export interface SamplePoint {
    frame: number;
    timestamp: number;
    data: Record<string, any>;
}

export interface TraceAnalysis {
    changedProperties: string[];
    maxDelta: Record<string, number>;
    trend: Record<string, string>;  // "increasing" | "decreasing" | "stable" | "fluctuating"
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
