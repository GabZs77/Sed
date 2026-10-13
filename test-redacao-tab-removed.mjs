import assert from "node:assert/strict";
import fs from "node:fs";

const app = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");

assert.ok(!app.includes('{href:"/redacao",label:"Redação",short:"Redação",icon:BookOpen},'));
assert.ok(!app.includes('path:"/redacao",component:RedacaoPage'));
assert.ok(!app.includes("function RedacaoPage(){"));
assert.ok(!html.includes('./redacao-api.js'));
assert.ok(!css.includes(".essay-page"));

for (const path of ["/tarefas", "/apostilas", "/inteligencia-artificial"]) {
  assert.ok(app.includes(`href:"${path}"`), `A navegação ${path} deve continuar disponível.`);
}

console.log("OK: aba, rota e estilos de Redação removidos; as demais áreas seguem na navegação.");
