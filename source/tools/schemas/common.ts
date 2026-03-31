export type JsonSchema = Record<string, any>;

export const uuid: JsonSchema = {
    type: 'string',
    description: 'UUID',
};

export const uuids: JsonSchema = {
    type: 'array',
    description: 'UUID list',
    items: { ...uuid },
};

export const path: JsonSchema = {
    type: 'string',
    description: 'Path',
};

export const dbPath: JsonSchema = {
    type: 'string',
    description: 'Asset path in db:// format',
};

export function actionEnum(values: string[], description: string): JsonSchema {
    return {
        type: 'string',
        enum: values,
        description,
    };
}
