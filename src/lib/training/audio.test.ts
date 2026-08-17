import assert from "node:assert/strict";
import test from "node:test";
import { downloadZernioAudio } from "./audio.ts";

test("downloads authenticated Zernio audio without exposing the key", async () => {
  let authorization = "";
  const result = await downloadZernioAudio({ apiKey: "secret-test-key", accountId: "acc", mediaId: "media",
    fetcher: (async (_url, init) => { authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/ogg", "content-length": "3" } }); }) as typeof fetch });
  assert.equal(authorization, "Bearer secret-test-key");
  assert.equal(result.mediaType, "audio/ogg");
  assert.deepEqual([...result.bytes], [1, 2, 3]);
});

test("rejects a non-audio attachment", async () => {
  await assert.rejects(() => downloadZernioAudio({ apiKey: "key", accountId: "acc", mediaId: "media",
    fetcher: (async () => new Response(new Uint8Array([1]), { headers: { "content-type": "image/png" } })) as typeof fetch }), /not audio/);
});
