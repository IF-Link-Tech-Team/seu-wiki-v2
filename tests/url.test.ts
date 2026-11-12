// The fetch guard: internal addresses stay unreachable in every spelling, and a name that resolves
// to one is refused at connect time too (DNS rebinding after the URL check).
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { Agent, fetch as undiciFetch } from "undici";
import { guardedFetch } from "@aihot/backend/lib/http-fetch";
import { assertPublicUrl, guardedLookup, isBlockedAddress } from "@aihot/backend/lib/url";

const server = http.createServer((_req, res) => res.end("internal"));
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
const { port } = server.address() as { port: number };
const agent = new Agent({ connect: { lookup: guardedLookup as never } });
after(async () => {
  server.close();
  await agent.close();
});

test("internal and reserved addresses are blocked in every spelling", () => {
  const blocked = [
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "255.255.255.255",
    "198.18.0.0", "198.18.0.1", "198.19.255.255", "::ffff:198.18.0.1", "64:ff9b::c612:1", "2002:c612:1::1",
    "::1", "::", "fd00::1", "fe80::1", "ff02::1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a00:1", "::ffff:a9fe:a9fe", "::7f00:1", // IPv4-mapped and -compatible
    "64:ff9b::7f00:1", "64:ff9b:1::1", "2002:7f00:1::1", "2001:0:4136:e378::1", // NAT64, 6to4, Teredo
    "not-an-ip",
  ];
  const allowed = ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"];
  assert.deepEqual(blocked.filter((a) => !isBlockedAddress(a)), [], "not blocked");
  assert.deepEqual(allowed.filter((a) => isBlockedAddress(a)), [], "wrongly blocked");
});

test("URL literals that embed a loopback address are refused before any request", async () => {
  for (const url of ["http://[::ffff:127.0.0.1]/", "http://[::127.0.0.1]/", "http://[64:ff9b::127.0.0.1]/", "http://localhost/"]) {
    await assert.rejects(assertPublicUrl(url), Error, url);
  }
  await assert.rejects(guardedFetch(`http://[::ffff:127.0.0.1]:${port}/`));
});

test("a name resolving to an internal address is refused at connect time", async () => {
  await assert.rejects(undiciFetch(`http://localhost:${port}/`, { dispatcher: agent }));
});

// Benchmark space is not public address space. Local proxy fake-IP routing must not make it a
// production exception; URL parsing also turns decimal/hex literals into the same destination.
test("benchmark literals are refused without a local-debug override", async () => {
  for (const host of ["198.18.0.1", "198.19.255.255", "3323068417", "0xc6120001", "[::ffff:198.18.0.1]"]) {
    await assert.rejects(assertPublicUrl(`http://${host}/`), /Blocked/, host);
  }
  assert.equal((await assertPublicUrl("http://198.18.0.1/", true)).hostname, "198.18.0.1");
});

test("blocked DNS names keep their boundary with a trailing root dot", async () => {
  const names = ["localhost", "child.localhost", "metadata.google.internal", "anything.internal"];
  for (const name of names) {
    await assert.rejects(assertPublicUrl(`http://${name}./`, false, async () => ["93.184.216.34"]), /Blocked host/, name);
  }
  assert.equal((await assertPublicUrl("https://example.org./", false, async () => ["93.184.216.34"])).hostname, "example.org.");
});

// PRIVATE_FEED_HOSTS: a self-hosted feed service (RSSHub in the same Docker network) on a listed
// name may use a private address, only as the configured listing address itself.
test("a listed private feed host may resolve to private service addresses, never to link-local or metadata", async () => {
  const answers: Record<string, string[]> = {};
  const resolve = async (host: string) => answers[host] ?? [];
  const listed = (url: string, hosts = ["rsshub"]) => assertPublicUrl(url, false, resolve, hosts);
  for (const address of ["10.0.0.5", "172.18.0.3", "192.168.1.9", "100.64.0.2", "127.0.0.1", "::1", "fd12:3456::5", "::ffff:172.18.0.3"]) {
    answers.rsshub = [address];
    assert.equal((await listed("http://RSSHub:1200/feed")).hostname, "rsshub", address);
    await assert.rejects(assertPublicUrl("http://rsshub:1200/feed", false, resolve), /Blocked/, `${address} without the list`);
  }
  for (const address of ["169.254.169.254", "169.254.170.2", "100.100.100.200", "::ffff:100.100.100.200", "::ffff:6464:64c8", "fd00:ec2::254", "fe80::1", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "0.0.0.0", "198.18.0.1", "224.0.0.1", "2001:db8::1"]) {
    answers.rsshub = [address];
    await assert.rejects(listed("http://rsshub:1200/feed"), /Blocked/, address);
  }
  answers.rsshub = ["10.0.0.5", "169.254.169.254"];
  await assert.rejects(listed("http://rsshub:1200/feed"), /Blocked/, "mixed answer");
  // Whole names only: no suffix, prefix or wildcard match.
  answers["feeds.rsshub"] = answers["rsshub.evil"] = ["10.0.0.5"];
  for (const url of ["http://feeds.rsshub/", "http://rsshub.evil/"]) await assert.rejects(listed(url), /Blocked/, url);
  // A listed .internal name (Docker's host.docker.internal) passes the name check; metadata names still fail by address.
  answers["host.docker.internal"] = ["192.168.65.254"];
  assert.equal((await listed("http://host.docker.internal:1200/", ["host.docker.internal"])).hostname, "host.docker.internal");
  await assert.rejects(assertPublicUrl("http://host.docker.internal:1200/", false, resolve), /Blocked host/);
  answers["metadata.google.internal"] = ["169.254.169.254"];
  await assert.rejects(listed("http://metadata.google.internal/", ["metadata.google.internal"]), /Blocked/);
  // Listed address literals.
  assert.equal((await listed("http://172.18.0.3:1200/", ["172.18.0.3"])).hostname, "172.18.0.3");
  await assert.rejects(listed("http://169.254.169.254/", ["169.254.169.254"]), /Blocked/);
});
