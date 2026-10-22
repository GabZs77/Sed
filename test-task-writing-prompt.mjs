import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./script.js", import.meta.url), "utf8");
assert.ok(source.includes('"text_answer":"resposta completa e fundamentada da questão"'));
assert.ok(source.includes("cubra cada um explicitamente"));
assert.ok(source.includes("detalhes específicos pertinentes apoiados no enunciado"));
assert.ok(source.includes("sem inventar fatos"));
assert.ok(!source.includes('"text_answer":"resposta curta da questão"'));
assert.ok(!source.includes("Escreva uma resposta final curta e correta para a questão"));
console.log("OK: prompts de questões escritas pedem respostas completas, específicas e apoiadas no material da questão.");
