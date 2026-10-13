import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

let captured;
const window = {};
const context = {
  window,
  fetch: async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify([
      { id: 1, is_essay: true, title: "Proposta de redação" },
      { id: 2, is_essay: false, title: "Atividade comum" },
    ]), { status: 200, headers: { "Content-Type": "application/json" } });
  },
};
vm.runInNewContext(fs.readFileSync(new URL("./redacao-api.js", import.meta.url), "utf8"), context);
const items = await window.__sedLoadEssays("token-for-this-test-only");
assert.equal(items.length, 1);
assert.equal(items[0].id, 1);
assert.equal(captured.options.headers["X-Api-Key"], "token-for-this-test-only");
assert.equal(captured.options.credentials, "omit");
assert.match(captured.url, /sdf-redacoes\.gabrielreplit56\.workers\.dev\/essays/);
await assert.rejects(() => window.__sedLoadEssays(""), /Faça login novamente/);
console.log("OK: cliente de redação encaminha a sessão sem persistência e filtra tarefas que não são redação.");
