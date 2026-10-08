// 退役页面的永久重定向：/for-you（「为你」已从 Web 端移除）、/survival（→东大生存手册）、
// /experience（→经验论坛）。各自的 $ 子路由仍在，旧文档/长文深链不受影响。
import { redirect, type LoaderFunctionArgs } from "react-router";

const TARGETS: Record<string, string> = {
  "/for-you": "/",
  "/survival": "/handbook",
  "/experience": "/experience-forum",
};

export function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const target = TARGETS[url.pathname] ?? "/";
  throw redirect(`${target}${url.search}`, 301);
}

export default function Null() {
  return null;
}
