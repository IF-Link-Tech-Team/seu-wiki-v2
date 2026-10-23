import { Link } from "react-router";
import { CategoryTabs } from "../features/feed/Filters";
import { EmptyState } from "../components/ui/Page";
import { pageMeta } from "../lib/seo";

export function meta() {
  return pageMeta({ title: "订阅", path: "/subscription", noindex: true });
}

export default function Subscription() {
  return (
    <div className="pb-6">
      <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">订阅</h1>
      <CategoryTabs active="subscription" layoutId="subscription-categories" className="mt-4" />
      <EmptyState title="订阅尚未开放" action={<Link to="/" className="font-medium text-accent hover:text-accent-ink">返回精选</Link>}>
        个性化规则仍在设计中，后续将提供与你相关的内容。
      </EmptyState>
    </div>
  );
}
