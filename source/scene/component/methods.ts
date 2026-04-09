import { safeSerialize } from '../../utils/serializer';
import { findNodeByUuid } from '../node/registry';

export const componentMethods: Record<string, (...args: any[]) => any> = {
    addComponentToNode(nodeUuid: string, componentType: string) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            const ComponentClass = js.getClassByName(componentType);
            if (ComponentClass) {
                const component = node.addComponent(ComponentClass);
                return {
                    success: true,
                    message: `Component ${componentType} added successfully`,
                    data: safeSerialize({ componentId: component.uuid }),
                };
            }

            return {
                success: false,
                error: `Script class '${componentType}' is not registered in scene process. The script may still be compiling — retry in 1-2 seconds.`,
            };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    removeComponentFromNode(nodeUuid: string, componentType: string) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            const ComponentClass = js.getClassByName(componentType);
            if (!ComponentClass) {
                return { success: false, error: `Component type ${componentType} not found` };
            }

            const component = node.getComponent(ComponentClass);
            if (!component) {
                return { success: false, error: `Component ${componentType} not found on node` };
            }

            node.removeComponent(component);
            return { success: true, message: `Component ${componentType} removed successfully` };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    setComponentProperty(nodeUuid: string, componentType: string, property: string, value: any) {
        try {
            const { director, js } = require('cc');
            const scene = director.getScene();
            if (!scene) {
                return { success: false, error: 'No active scene' };
            }

            const node = findNodeByUuid(scene, nodeUuid);
            if (!node) {
                return { success: false, error: `Node with UUID ${nodeUuid} not found` };
            }

            const ComponentClass = js.getClassByName(componentType);
            if (!ComponentClass) {
                return { success: false, error: `Component type ${componentType} not found` };
            }

            const component = node.getComponent(ComponentClass);
            if (!component) {
                return { success: false, error: `Component ${componentType} not found on node` };
            }

            if (property === 'spriteFrame' && componentType === 'cc.Sprite') {
                if (typeof value === 'string') {
                    const assetManager = require('cc').assetManager;
                    assetManager.resources.load(value, require('cc').SpriteFrame, (error: any, spriteFrame: any) => {
                        if (!error && spriteFrame) {
                            component.spriteFrame = spriteFrame;
                        } else {
                            assetManager.loadAny({ uuid: value }, (fallbackError: any, asset: any) => {
                                if (!fallbackError && asset) {
                                    component.spriteFrame = asset;
                                } else {
                                    component.spriteFrame = value;
                                }
                            });
                        }
                    });
                } else {
                    component.spriteFrame = value;
                }
            } else if (property === 'material' && (componentType === 'cc.Sprite' || componentType === 'cc.MeshRenderer')) {
                if (typeof value === 'string') {
                    const assetManager = require('cc').assetManager;
                    assetManager.resources.load(value, require('cc').Material, (error: any, material: any) => {
                        if (!error && material) {
                            component.material = material;
                        } else {
                            assetManager.loadAny({ uuid: value }, (fallbackError: any, asset: any) => {
                                if (!fallbackError && asset) {
                                    component.material = asset;
                                } else {
                                    component.material = value;
                                }
                            });
                        }
                    });
                } else {
                    component.material = value;
                }
            } else if (property === 'string' && (componentType === 'cc.Label' || componentType === 'cc.RichText')) {
                component.string = value;
            } else {
                component[property] = value;
            }

            return { success: true, message: `Component property '${property}' updated successfully` };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    getRegisteredClasses(extendsFilter?: string) {
        try {
            const { js } = require('cc');
            const filterClass = extendsFilter ? js.getClassByName(extendsFilter) : null;
            const allClasses: string[] = [];
            const classMap = (js as any)._nameToClass || {};
            for (const name of Object.keys(classMap)) {
                const cls = classMap[name];
                if (!filterClass || (cls.prototype instanceof filterClass)) {
                    allClasses.push(name);
                }
            }
            return { success: true, data: safeSerialize({ classes: allClasses, count: allClasses.length }) };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    },

    async evalScript(script: string) {
        const TIMEOUT = 10000;
        const withTimeout = (promise: Promise<any>) => Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Script timeout (10s)')), TIMEOUT)),
        ]);

        const autoReturn = (source: string): string => {
            if (/\breturn\b/.test(source)) return source;
            const statements = source.trimEnd().split(';').map((item) => item.trim()).filter((item) => item);
            if (!statements.length) return source;
            const lastStatement = statements[statements.length - 1];
            if (/^(var|let|const|if|for|while|switch|try|function|class|throw|do)\b/.test(lastStatement)) return source;
            if (/[{}]/.test(lastStatement)) return source;
            statements[statements.length - 1] = 'return ' + lastStatement;
            return statements.join('; ') + ';';
        };

        try {
            const wrapped = new Function('require', `return (async () => { ${autoReturn(script)} })()`);
            const result = await withTimeout(wrapped(require));
            return { success: true, data: { result: safeSerialize(result) } };
        } catch {
            try {
                const result = eval(script);
                if (result && typeof result === 'object' && typeof result.then === 'function') {
                    const resolved = await withTimeout(result);
                    return { success: true, data: { result: safeSerialize(resolved) } };
                }
                return { success: true, data: { result: safeSerialize(result) } };
            } catch (error: any) {
                return { success: false, error: error.message };
            }
        }
    },
};
