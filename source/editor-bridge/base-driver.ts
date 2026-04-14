import { RuntimeProfile } from '../runtime/profile';

/**
 * 所有 editor-bridge driver 的公共基类。
 *
 * 封装了 Editor.Message.request 的可用性检查和类型安全的调用方法，
 * 消除了各 driver 中重复的 ensureAvailable / request 基础设施。
 */
export abstract class BaseDriver {
    constructor(protected readonly profile: RuntimeProfile) {}

    // -----------------------------------------------------------------------
    // 可用性检查
    // -----------------------------------------------------------------------

    /**
     * 检查 Editor.Message.request 是否可用（不检查 feature flag）。
     * 适用于需要灵活组合多个 feature 的场景。
     */
    protected ensureRequestAvailable(): void {
        if (typeof (globalThis as any).Editor?.Message?.request !== 'function') {
            throw new Error('Editor.Message.request is unavailable in the current runtime');
        }
    }

    /**
     * 检查 Editor.Message.request 是否可用 + 指定 feature 是否启用。
     * 适用于大多数 driver 的标准可用性检查。
     */
    protected ensureFeatureAvailable(feature: keyof RuntimeProfile['features']): void {
        this.ensureRequestAvailable();
        if (!this.profile.features[feature]) {
            throw new Error(`Runtime profile does not support '${feature}'`);
        }
    }

    // -----------------------------------------------------------------------
    // IPC 请求
    // -----------------------------------------------------------------------

    /**
     * 向指定 channel 发送 IPC 请求。
     *
     * 使用 `message as never` 绕过 @cocos/creator-types 的严格消息映射，
     * 因为我们的 contract 类型（NodeCreateInput 等）与 Cocos 类型（CreateNodeOptions）
     * 结构兼容但名义类型不同。
     */
    protected async request<T = unknown>(
        channel: string,
        message: string,
        ...args: unknown[]
    ): Promise<T> {
        return (globalThis as any).Editor.Message.request(
            channel,
            message as never,
            ...args,
        ) as Promise<T>;
    }
}
