/**
 * 用户信息
 */
export interface UserInfo {
  /** 用户 ID */
  id?: string;
  /** 用户邮箱 */
  email?: string;
  /** 用户名 */
  username?: string;
  /** 扩展字段 */
  [key: string]: unknown;
}
