export interface GuideEntry { title: string; slug: string; groups: string[] }
export interface GuideArticle { title: string; slug: string; html: string }

interface Node { name: string; children: Node[]; article?: GuideEntry }

export function GuideContents({ articles }: { articles: GuideEntry[] }) {
  const root: Node = { name: "", children: [] };
  const ordered = [...articles.filter((article) => article.slug !== "cr8aqk"), ...articles.filter((article) => article.slug === "cr8aqk")];
  for (const article of ordered) {
    let current = root;
    for (const group of article.groups) {
      let next = current.children.find((node) => !node.article && node.name === group);
      if (!next) { next = { name: group, children: [] }; current.children.push(next); }
      current = next;
    }
    current.children.push({ name: article.title, children: [], article });
  }
  function render(nodes: Node[]) {
    return <ul className="space-y-1 border-l border-line pl-3">{nodes.map((node, i) => <li key={`${node.name}-${i}`}>
      {node.article ? <a className="block rounded-control px-2 py-1 text-ink-3 hover:bg-bg-sunk hover:text-accent" href={`#guide-${node.article.slug}`}>{node.name}</a> : <details open><summary className="cursor-pointer py-1 font-semibold text-ink">{node.name}</summary>{render(node.children)}</details>}
    </li>)}</ul>;
  }
  return <nav aria-label="生存指南 2.0 目录" className="text-[13px] leading-relaxed" onClick={(event) => {
    if ((event.target as HTMLElement).closest("a[href^='#guide-']")) {
      const mobileContents = event.currentTarget.closest("details");
      if (mobileContents) mobileContents.open = false;
    }
  }}>
    {render(root.children)}
    <p className="mt-5 text-[12px] leading-relaxed text-ink-4">东南大学校友编写团队原著，IF.Link 社区经授权非商业转载整理，著作权归原作者团队，禁止商业用途。<a className="text-accent hover:underline" href="https://github.com/IF-Link-Tech-Team/seu-survival-guide-2.0">原稿出处</a></p>
  </nav>;
}

export function GuideReader({ articles }: { articles: GuideArticle[] }) {
  // 原索引的致谢在序言前；默认从序言阅读，并把致谢放在全文末尾。
  const preface = articles.find((article) => article.slug === "ol2iwr");
  const acknowledgements = articles.find((article) => article.slug === "cr8aqk");
  const ordered = [preface, ...articles.filter((article) => article !== preface && article !== acknowledgements), acknowledgements].filter((article): article is GuideArticle => !!article);
  return <div className="pb-10">
    <h1 className="pt-5 font-serif text-[30px] font-bold leading-snug text-ink lg:pt-0 lg:text-[34px]">生存手册 2.0（2023）</h1>
    {ordered.map((article) => <article id={`guide-${article.slug}`} key={article.slug} className="scroll-mt-6 border-b border-line pb-10 pt-8 last:border-b-0 lg:[&+article]:pt-10">
    <h2 className="font-serif text-[26px] font-bold leading-snug text-ink lg:text-[30px]">{article.title}</h2>
    <div className="prose mt-6" dangerouslySetInnerHTML={{ __html: article.html }} />
  </article>)}</div>;
}
