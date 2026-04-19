import { test, mock } from "node:test";
import assert from "node:assert/strict";
import {
  handleSalesforceCreateContacts,
  handleSalesforceQuery,
  handleSalesforceQueryNext,
} from "../salesforce.js";

test("handleSalesforceCreateContacts batches composite requests", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = JSON.parse(options.body);
    calls.push({ url, body: parsed });
    assert.equal(options.method, "POST");
    const n = parsed.records.length;
    const rows = Array.from({ length: n }, (_, i) => ({
      id: `id-${calls.length}-${i}`,
      success: true,
    }));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(rows),
    };
  });

  process.env.SALESFORCE_INSTANCE_URL = "https://example.my.salesforce.com/";
  process.env.SALESFORCE_ACCESS_TOKEN = "tok";

  const records = Array.from({ length: 26 }, (_, i) => ({
    LastName: `User${i}`,
    Email: `u${i}@test.com`,
  }));

  const result = await handleSalesforceCreateContacts({ records });

  assert.equal(result.totalRequested, 26);
  assert.equal(result.results.length, 26);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.records.length, 25);
  assert.equal(calls[1].body.records.length, 1);
  assert.equal(calls[0].body.records[0].attributes.type, "Contact");
  assert.match(calls[0].url, /\/services\/data\/v59\.0\/composite\/sobjects$/);

  mock.restoreAll();
  delete process.env.SALESFORCE_INSTANCE_URL;
  delete process.env.SALESFORCE_ACCESS_TOKEN;
});

test("handleSalesforceQuery encodes SOQL", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    assert.match(u, /query\?q=/);
    assert.ok(u.includes(encodeURIComponent("SELECT Id FROM Contact LIMIT 1")));
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ records: [], done: true, totalSize: 0 }),
    };
  });

  process.env.SALESFORCE_INSTANCE_URL = "https://x.salesforce.com";
  process.env.SALESFORCE_ACCESS_TOKEN = "t";

  const data = await handleSalesforceQuery({ q: "SELECT Id FROM Contact LIMIT 1" });
  assert.deepEqual(data.records, []);

  mock.restoreAll();
  delete process.env.SALESFORCE_INSTANCE_URL;
  delete process.env.SALESFORCE_ACCESS_TOKEN;
});

test("handleSalesforceQueryNext uses path relative to instance", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(
      String(url),
      "https://x.salesforce.com/services/data/v59.0/query/abc"
    );
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ records: [], done: true, totalSize: 0 }),
    };
  });

  process.env.SALESFORCE_INSTANCE_URL = "https://x.salesforce.com";
  process.env.SALESFORCE_ACCESS_TOKEN = "t";

  await handleSalesforceQueryNext({
    nextRecordsUrl: "/services/data/v59.0/query/abc",
  });

  mock.restoreAll();
  delete process.env.SALESFORCE_INSTANCE_URL;
  delete process.env.SALESFORCE_ACCESS_TOKEN;
});
