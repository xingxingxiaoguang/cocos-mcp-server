export interface SerializeOptions {
    maxDepth?: number;
    maxArrayLength?: number;
    maxObjectKeys?: number;
}

const DEFAULT_OPTIONS: Required<SerializeOptions> = {
    maxDepth: 4,
    maxArrayLength: 100,
    maxObjectKeys: 50,
};

const FALLBACK_OBJECT_KEYS = [
    'name',
    'uuid',
    'active',
    'position',
    'rotation',
    'scale',
    'x',
    'y',
    'z',
    'w',
    'width',
    'height',
    'r',
    'g',
    'b',
    'a',
    'children',
    'components',
    'parent',
];

function hasMeaningfulContent(value: unknown, depth: number = 0): boolean {
    if (depth > 7) return true;
    if (value === null || value === undefined) return false;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean' || type === 'bigint') return true;
    if (type === 'function') return false;

    if (Array.isArray(value)) {
        if (value.length === 0) return false;
        return value.some((item) => hasMeaningfulContent(item, depth + 1));
    }

    if (type === 'object') {
        const keys = Object.keys(value as Record<string, unknown>);
        if (keys.length === 0) return false;
        return keys.some((key) => hasMeaningfulContent((value as Record<string, unknown>)[key], depth + 1));
    }

    return true;
}

function serializeInternal(
    value: unknown,
    depth: number,
    seen: WeakSet<object>,
    options: Required<SerializeOptions>,
    allowJsonRoundTrip: boolean = true,
): unknown {
    if (depth > options.maxDepth) return '[max depth]';
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === 'number' || type === 'string' || type === 'boolean') return value;
    if (type === 'bigint') return value.toString();
    if (type === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;

    if (Array.isArray(value)) {
        return value
            .slice(0, options.maxArrayLength)
            .map((item) => serializeInternal(item, depth + 1, seen, options));
    }

    if (value instanceof Date) {
        return value.toISOString();
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        };
    }

    if (type === 'object') {
        if (value instanceof String || value instanceof Number || value instanceof Boolean) {
            return value.valueOf();
        }

        if (seen.has(value as object)) {
            return '[circular]';
        }
        seen.add(value as object);

        try {
            try {
                if (allowJsonRoundTrip) {
                    const json = JSON.stringify(value);
                    if (json) {
                        const parsed = JSON.parse(json);
                        if (hasMeaningfulContent(parsed)) {
                            return serializeInternal(parsed, depth, seen, options, false);
                        }
                    }
                }
            } catch {
                // Ignore JSON round-trip failures and continue with manual extraction.
            }

            const source = value as Record<string, unknown>;
            const keys = Object.keys(source);
            const inspectKeys = keys.length > 0 ? keys : FALLBACK_OBJECT_KEYS;
            const result: Record<string, unknown> = {};

            for (const key of inspectKeys.slice(0, options.maxObjectKeys)) {
                try {
                    const item = source[key];
                    if (item !== undefined && typeof item !== 'function') {
                        result[key] = serializeInternal(item, depth + 1, seen, options);
                    }
                } catch {
                    // Skip inaccessible property.
                }
            }

            if (Object.keys(result).length > 0) {
                return result;
            }

            try {
                const primitive = typeof source.valueOf === 'function' ? source.valueOf() : value;
                if (
                    primitive !== value &&
                    (typeof primitive === 'string' || typeof primitive === 'number' || typeof primitive === 'boolean')
                ) {
                    return primitive;
                }
            } catch {
                // Ignore valueOf failures.
            }

            try {
                return String(value);
            } catch {
                return '[object]';
            }
        } finally {
            seen.delete(value as object);
        }
    }

    return String(value);
}

export function safeSerialize(value: unknown, options: SerializeOptions = {}): unknown {
    return serializeInternal(value, 0, new WeakSet<object>(), {
        ...DEFAULT_OPTIONS,
        ...options,
    });
}
