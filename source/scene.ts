import { join } from 'path';
import { animationMethods } from './scene/animation/methods';
import { componentMethods } from './scene/component/methods';
import { nodeMethods } from './scene/node/methods';

module.paths.push(join(Editor.App.path, 'node_modules'));

export const methods = {
    ...nodeMethods,
    ...componentMethods,
    ...animationMethods,
};
