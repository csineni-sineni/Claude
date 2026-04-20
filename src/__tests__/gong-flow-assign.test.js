import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { handleGongAddProspectsToFlow } from "../gong.js";

test("handleGongAddProspectsToFlow posts to /v2/flows/prospects/assign", async (t) => {
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "https://api.gong.io/v2/flows/prospects/assign");
    assert.equal(options.method, "POST");
    const body = JSON.parse(options.body);
    assert.deepEqual(body.crmProspectsIds, ["003xx00000abcd"]);
    assert.equal(body.flowId, "flow-1");
    assert.equal(body.flowInstanceOwnerEmail, "rep@example.com");
    return {
      ok: true,
      status: 200,
      json: async () => ({ requestId: "r1", prospectsAssigned: [] }),
    };
  });

  process.env.GONG_ACCESS_KEY = "k";
  process.env.GONG_ACCESS_KEY_SECRET = "s";

  const result = await handleGongAddProspectsToFlow({
    flowId: "flow-1",
    crmProspectsIds: ["003xx00000abcd"],
    flowInstanceOwnerEmail: "rep@example.com",
  });

  assert.equal(result.requestId, "r1");
  mock.restoreAll();
  delete process.env.GONG_ACCESS_KEY;
  delete process.env.GONG_ACCESS_KEY_SECRET;
});

test("handleGongAddProspectsToFlow forwards optional overrides", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.overrides.coolOffOverride, true);
    assert.equal(body.flowInstanceDescription, "desc");
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
    };
  });

  process.env.GONG_ACCESS_KEY = "k";
  process.env.GONG_ACCESS_KEY_SECRET = "s";

  await handleGongAddProspectsToFlow({
    flowId: "f",
    crmProspectsIds: ["a"],
    flowInstanceOwnerEmail: "e@e.com",
    overrides: { coolOffOverride: true },
    flowInstanceDescription: "desc",
  });

  mock.restoreAll();
  delete process.env.GONG_ACCESS_KEY;
  delete process.env.GONG_ACCESS_KEY_SECRET;
});
