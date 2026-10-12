import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
assert.equal(bundle.includes('fetchOptional("/tarefas")'), false, "A rota Tarefas não deve sobrescrever o dashboard com uma segunda resposta");
const start = bundle.indexOf("function asObject(");
const end = bundle.indexOf("const agendaTextureUrl", start);
if (start < 0 || end < 0) throw new Error("Não foi possível localizar os normalizadores no bundle");

const context = {};
vm.runInNewContext(`${bundle.slice(start, end)}\nthis.normalizeTasks = normalizeTasks;\nthis.hydrateTaskRooms = hydrateTaskRooms;`, context);

const questionStart = bundle.indexOf("function hasAnswer");
const questionEnd = bundle.indexOf("function extractTaskStatement", questionStart);
const questionContext = {};
vm.runInNewContext(`${bundle.slice(questionStart, questionEnd)}\nthis.extractTaskQuestions = extractTaskQuestions;\nthis.normalizeQuestionType = normalizeQuestionType;\nthis.hasAnswer = hasAnswer;`, questionContext);

const rooms = [{ CodigoTurma: 42, NomeTurma: "3A - Sala de Leitura", descricao: "3A - Sala de Leitura" }];
const tasks = {
  data: [
    { id: "atividade-1", titulo: "Tarefa 1: Fluxos globais: conceitos, informação e tecnologia", nome: "3A - Sala de Leitura" },
    { id: "atividade-2", title: "Tarefa 2: Prosa regionalista romântica", room_name: "3A - Sala de Leitura" },
  ],
};

const normalized = context.hydrateTaskRooms(context.normalizeTasks(tasks), rooms);
assert.deepEqual(normalized.map((task) => task.title), [
  "Tarefa 1: Fluxos globais: conceitos, informação e tecnologia",
  "Tarefa 2: Prosa regionalista romântica",
]);
assert.deepEqual(normalized.map((task) => task.roomName), [
  "3A - Sala de Leitura",
  "3A - Sala de Leitura",
]);

assert.equal(questionContext.normalizeQuestionType("fill-words", {}), "fill");
const fillQuestions = questionContext.extractTaskQuestions({
  questions: [{
    id: "q3",
    type: "fill-words",
    statement: "Complete a frase:",
    options: {
      phrase: [
        { value: "A água pode estar no estado", fixed: true },
        { value: "", fixed: false },
        { value: ".", fixed: true },
      ],
      choices: ["sólido", "líquido", "gasoso"],
    },
  }],
});
assert.equal(fillQuestions[0].type, "fill");
assert.deepEqual(fillQuestions[0].raw.options.choices, ["sólido", "líquido", "gasoso"]);
assert.equal(questionContext.hasAnswer({ 0: "líquido" }, "fill"), true);
assert.equal(questionContext.hasAnswer({ 0: "" }, "fill"), false);

console.log("OK: fill usa phrase/choices e títulos permanecem separados da sala.");
