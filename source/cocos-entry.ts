import { join } from 'path';
import { animationMethods } from './cocos-runtime/animation/methods';
import { componentMethods } from './cocos-runtime/component/methods';
import { nodeMethods } from './cocos-runtime/node/methods';

module.paths.push(join(Editor.App.path, 'node_modules'));

export const methods = {
    ...nodeMethods,
    ...componentMethods,
    ...animationMethods,
};
