import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { buildApp } from "../apps/api/src/app.ts";

const key=tag();const source=`test-subscription-${key}`;const app=await buildApp();
const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const ids:string[]=[];
before(async()=>{
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext,syndicate_fulltext,next_fetch_at)
    VALUES (${source},'自动化学院','rss','T1','editorial',false,false,'2100-01-01')`;
  for(let i=0;i<4;i++){
    const {articleId}=await upsertMaterial({sourceId:source,url:`https://example.com/sub-${key}-${i}`,title:`人工智能讲座预告${key}-${i}`,bodyText:'PRIVATE BODY MUST NOT LEAK',bodyStatus:'ok',via:'fetch',publishedAt:new Date()});
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,title_zh,summary_zh,score,selected)
      VALUES (${articleId},1,'rule','pass','academic',${`人工智能讲座预告${key}-${i}`},'面向全校学生。欢迎参加。',90,true)`;
    await publishArticle(articleId,{releasedAt:new Date(Date.now()-60000)});ids.push(articleId);
  }
  await sql`UPDATE publications SET visibility='withdrawn' WHERE article_id=${ids[1]}`;
  await sql`UPDATE publications SET visible_after=${new Date(Date.now()+86400000)} WHERE article_id=${ids[2]}`;
  await sql`UPDATE publications SET eligible=false WHERE article_id=${ids[3]}`;
});
after(async()=>{await app.close();await closeDb();});

test("subscription POST respects publication visibility, eligibility and release, without leaking bodies",async()=>{
  const res=await app.inject({method:'POST',url:'/api/site/subscription-preview',payload:{profile:{interests:['topic:AI/机器学习']},asOf:day,lane:'matched',q:key}});
  assert.equal(res.statusCode,200);assert.equal(res.headers['cache-control'],'private, no-store');
  const data=res.json();assert.deepEqual(data.items.map((x:{id:string})=>x.id),[ids[0]]);
  assert.ok(!res.body.includes('PRIVATE BODY'));assert.equal(data.counts.matched+data.counts.possible+data.counts.excluded,data.total);
  const feed=await app.inject({method:'POST',url:'/api/site/subscription-preview',payload:{profile:{interests:['topic:AI/机器学习']},asOf:day,lane:'feed',q:key}});
  assert.equal(feed.statusCode,200);assert.deepEqual(feed.json().items.map((x:{id:string})=>x.id),[ids[0]]);
});
test("subscription validates date and normalizes untrusted profile arrays",async()=>{
  const bad=await app.inject({method:'POST',url:'/api/site/subscription-preview',payload:{asOf:'2026-02-30'}});assert.equal(bad.statusCode,400);
  const res=await app.inject({method:'POST',url:'/api/site/subscription-preview',payload:{profile:{interests:[null,{},'evil'],college:'evil'},asOf:day,lane:'excluded',q:key,page:-8}});
  assert.equal(res.statusCode,200);assert.deepEqual(res.json().profile.interests,[]);assert.equal(res.json().page,1);
});

test("production disables profile preview and taxonomy endpoints",async()=>{
  const previous=process.env.NODE_ENV;
  try {
    process.env.NODE_ENV='production';
    for(const request of [{method:'POST' as const,url:'/api/site/subscription-preview',payload:{profile:{degree:'本科生'},asOf:day}},{method:'GET' as const,url:'/api/site/subscription-taxonomy'}]){
      const res=await app.inject(request);
      assert.equal(res.statusCode,404);
      assert.equal(res.headers['cache-control'],'private, no-store');
      assert.equal(res.json().error,'local_preview_only');
    }
  } finally {
    if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;
  }
});
