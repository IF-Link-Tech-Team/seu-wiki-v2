// member 认证的配置：全部来自环境变量（auth 组凭证），任何一项缺失都视为"账号功能未启用"——
// 匿名浏览是主路径，未启用时登录入口不显示、相关路由返 503，其余功能不受影响。
import { credential } from "../config.ts";

export interface MemberAuthConfig {
  logtoEndpoint: string;
  appId: string;
  appSecret: string;
  cookieSecret: string;
  /** 本站公网地址（回调用它重建，不信 Host/Forwarded 头）。 */
  baseUrl: string;
  accountsUrl: string;
  accountsApiResource: string;
  m2mAppId: string;
  m2mAppSecret: string;
}

/** 延迟到每次调用时读：测试和运行时改环境变量都生效。 */
export function memberAuthConfig(): MemberAuthConfig | null {
  const get = (name: string) => credential("auth", name);
  const logtoEndpoint = get("LOGTO_ENDPOINT")?.replace(/\/+$/, "");
  const appId = get("LOGTO_APP_ID");
  const appSecret = get("LOGTO_APP_SECRET");
  const cookieSecret = get("LOGTO_COOKIE_SECRET");
  const baseUrl = get("LOGTO_BASE_URL")?.replace(/\/+$/, "");
  const accountsUrl = get("ACCOUNTS_URL")?.replace(/\/+$/, "");
  const accountsApiResource = get("ACCOUNTS_API_RESOURCE");
  const m2mAppId = get("ACCOUNTS_M2M_APP_ID");
  const m2mAppSecret = get("ACCOUNTS_M2M_APP_SECRET");
  if (!logtoEndpoint || !appId || !appSecret || !cookieSecret || cookieSecret.length < 32 || !baseUrl || !accountsUrl || !accountsApiResource || !m2mAppId || !m2mAppSecret) {
    return null;
  }
  return { logtoEndpoint, appId, appSecret, cookieSecret, baseUrl, accountsUrl, accountsApiResource, m2mAppId, m2mAppSecret };
}
