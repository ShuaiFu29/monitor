import type { UserInfo } from '@monitor/types';
import { generateId, getCurrentUrl, getUserAgent } from '@monitor/utils';

/**
 * 会话管理器
 *
 * 职责：
 * - 生成和维护 sessionId
 * - 管理用户信息
 * - 提供事件公共上下文（url, userAgent, sessionId, userId 等）
 */
export class SessionManager {
  private sessionId: string;
  private user: UserInfo = {};
  private readonly startTime: number;

  constructor() {
    this.sessionId = generateId();
    this.startTime = Date.now();
  }

  /**
   * 获取当前 sessionId
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * 重新生成 sessionId
   */
  renewSession(): void {
    this.sessionId = generateId();
  }

  /**
   * 设置用户信息
   */
  setUser(user: UserInfo): void {
    this.user = { ...this.user, ...user };
  }

  /**
   * 获取用户信息
   */
  getUser(): UserInfo {
    return { ...this.user };
  }

  /**
   * 获取用户 ID
   */
  getUserId(): string | undefined {
    return this.user.id;
  }

  /**
   * 获取事件公共上下文
   * 每个事件都会携带的基础信息
   */
  getEventContext(): Record<string, unknown> {
    return {
      sessionId: this.sessionId,
      userId: this.user.id,
      url: getCurrentUrl(),
      userAgent: getUserAgent(),
      sessionDuration: Date.now() - this.startTime,
    };
  }
}
