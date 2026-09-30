// Creates .env from .env.example with fresh random secrets. Refuses to overwrite an existing .env.
// 后台登录走 IF.Link 统一账户（LOGTO_*/ACCOUNTS_*），init-env 不再生成管理员密码。
//   node scripts/init-env.ts [--llm-key <key>]
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

if (existsSync(".env")) {
  console.error(".env 已经存在，没有覆盖。要重新生成，先把它改名或删掉。");
  process.exit(1);
}
const keyAt = process.argv.indexOf("--llm-key");
const llmKey = keyAt > 0 ? (process.argv[keyAt + 1] ?? "") : "";
const text = readFileSync(".env.example", "utf8")
  .replace(/^SESSION_SECRET=$/m, `SESSION_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^IMG_PROXY_SIGN_SECRET=$/m, `IMG_PROXY_SIGN_SECRET=${randomBytes(32).toString("hex")}`)
  .replace(/^POSTGRES_PASSWORD=$/m, `POSTGRES_PASSWORD=${randomBytes(18).toString("hex")}`)
  .replace(/^LLM_API_KEY=$/m, `LLM_API_KEY=${llmKey}`);
writeFileSync(".env", text, { mode: 0o600 });
console.log("已生成 .env。");
console.log("后台登录：配置 IF.Link 统一账户（.env 里的 LOGTO_* 与 ACCOUNTS_* 九项）后，/admin 用社区账户登录；本地改前端可设 DEV_ADMIN_BYPASS=true（仅非生产）。");
if (!llmKey) console.log("还差一步：在 .env 里填上 LLM_API_KEY（以及 LLM_BASE_URL、LLM_MODEL，默认是 DeepSeek）。");
