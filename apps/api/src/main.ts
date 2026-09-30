import { assertProductionSecrets, config } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { memberAuthConfig } from "@aihot/backend/member/config";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";
import { startWorkerWatchdog } from "@aihot/backend/operations/watch";
import { buildApp } from "./app.ts";

assertProductionSecrets([
  ["auth", "SESSION_SECRET"],
  ["auth", "IMG_PROXY_SIGN_SECRET"],
]);
// 后台登录已切换到 IF.Link 统一账户（决策 13.7）。生产环境没配置就拒绝给后台放行是不可能的——
// 未配置时 /admin 不可用但站点其余功能必须正常（匿名浏览是主路径），所以这里只告警；
// 生产 + DEV_ADMIN_BYPASS 才拒绝启动（assertProductionSecrets）。
if (config.environmentName === "production" && !memberAuthConfig()) {
  console.error("WARNING: IF.Link member auth (LOGTO_*/ACCOUNTS_*) is not configured; /admin sign-in is unavailable. The rest of the site works.");
}

const app = await buildApp();
await app.listen({ port: config.apiPort, host: process.env.API_HOST || "127.0.0.1" });
startHeartbeat(`api:${config.apiPort}`);
startWorkerWatchdog();

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();

  await closeDb();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
