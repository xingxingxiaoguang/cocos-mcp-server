import * as assert from 'assert';

(globalThis as any).Editor = {
    App: {
        path: process.cwd(),
    },
};

const sceneModule = require('../scene') as { methods?: Record<string, unknown> };

function main(): void {
    assert.ok(sceneModule.methods, 'scene facade should export methods');
    assert.ok(typeof sceneModule.methods?.createAnimationClip === 'function');
    assert.ok(typeof sceneModule.methods?.getNodeInfo === 'function');
    assert.ok(typeof sceneModule.methods?.saveAnimationClip === 'function');
    console.log('[scene-facade-smoke] OK');
}

try {
    main();
} catch (error) {
    console.error('[scene-facade-smoke] FAILED');
    console.error(error);
    process.exit(1);
}
