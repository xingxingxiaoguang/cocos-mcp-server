export async function tryEditorThenEngine<T>(
    editorFn: () => Promise<T>,
    isValid: (result: T) => boolean,
    engineFn: () => Promise<T>,
): Promise<T> {
    try {
        const result = await editorFn();
        if (isValid(result)) return result;
    } catch {
        // editor API unavailable, fall through
    }

    return engineFn();
}

export function isValidResult(result: any): boolean {
    return result !== null && result !== undefined && result !== false;
}
