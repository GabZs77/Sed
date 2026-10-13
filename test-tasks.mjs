import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const reference = fs.readFileSync(new URL("./atividade-lacunas-completo.js", import.meta.url), "utf8");
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("./style.css", import.meta.url), "utf8");
assert.ok(html.indexOf("atividade-lacunas-completo.js") < html.indexOf('type="module" src="./script.js"'), "O helper de lacunas deve carregar antes do app");
assert.ok(bundle.includes('className:"mobile-close",onClick:h'), "O botão X deve acionar o fechamento do menu lateral");
assert.ok(css.includes(".side-rail.is-open{transform:translate(0)}"), "O estado aberto do menu móvel deve continuar controlado por transform");
assert.ok(!css.includes(".card,.side-rail,.task-reader-modal"), "A animação de entrada não deve sobrescrever o transform usado para fechar o menu");
assert.ok(css.includes(".mobile-close{position:relative;z-index:2;touch-action:manipulation;cursor:pointer}"), "O botão X deve permanecer acessível ao toque no celular");
assert.ok(reference.includes("window.__sdfGapChoices = gapChoices"), "O helper deve expor o extrator de palavras");
assert.equal(bundle.includes('fetchOptional("/tarefas")'), false, "A rota Tarefas não deve sobrescrever o dashboard com uma segunda resposta");
const start = bundle.indexOf("function asObject(");
const end = bundle.indexOf("const agendaTextureUrl", start);
if (start < 0 || end < 0) throw new Error("Não foi possível localizar os normalizadores no bundle");

const context = {};
vm.runInNewContext(`${bundle.slice(start, end)}\nthis.normalizeTasks = normalizeTasks;\nthis.hydrateTaskRooms = hydrateTaskRooms;\nthis.formatTaskDeadline = formatTaskDeadline;\nthis.taskDeadlineExpired = taskDeadlineExpired;`, context);

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
const withDeadlines = context.normalizeTasks({ data: [
  { id: "prazo-1", dataLimite: "2099-05-06", code: "ATV-01" },
  { id: "prazo-2", dueAt: "2099-05-06T17:30:00", code: "ATV-02" },
  { id: "prazo-legado", apply_moment: "2099-06-01" },
  { id: "prazo-antigo", deadline: "2000-01-01" },
] });
assert.equal(withDeadlines.find((task) => task.id === "prazo-1").due, "2099-05-06");
assert.equal(withDeadlines.find((task) => task.id === "prazo-1").status, "pending");
assert.equal(withDeadlines.find((task) => task.id === "prazo-legado").due, "2099-06-01");
assert.equal(context.formatTaskDeadline("2099-05-06"), "06/05/2099");
assert.ok(context.formatTaskDeadline("2099-05-06T17:30:00").includes("17:30"));
assert.equal(context.taskDeadlineExpired("2000-01-01"), true);
assert.equal(context.taskDeadlineExpired(new Date().toISOString().slice(0, 10)), false, "Uma tarefa vence no final do dia informado");
assert.ok(bundle.includes("Prazo de envio:"), "O card deve rotular claramente o prazo");
assert.ok(bundle.includes("a.code||\"\""), "O código da atividade não deve mais ocultar o prazo");
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
const orderedQuestions = questionContext.extractTaskQuestions({ questions: [{
  id: "q-word-order",
  type: "text",
  statement: 'O Texto 1 apresenta um trecho inicial do romance "Inocência", escrito pelo Visconde de Taunay durante o movimento romântico. Com base no trecho, ordene as palavras a seguir para formar uma frase que sintetize uma característica da prosa regionalista romântica.',
  options: { word_bank: ["A", "vida", "regionalista", "romântica", "representava", "o", "modo", "de", "prosa", "sertanejo."] },
}] });
assert.equal(orderedQuestions[0].type, "word-order", "Um enunciado de ordenação com banco de palavras não deve virar resposta escrita");
assert.equal(orderedQuestions[0].rawType, "text", "O tipo original deve ser preservado para o envio");
assert.equal(questionContext.hasAnswer(["A", "vida"], "word-order"), true);
assert.equal(questionContext.hasAnswer([], "word-order"), false);
const essayWithoutBank = questionContext.extractTaskQuestions({ questions: [{ type: "text", statement: "Escreva uma redação sobre a sua rotina." }] });
assert.equal(essayWithoutBank[0].type, "text", "Uma resposta escrita comum continua sendo textual");

const fillHelpersStart = bundle.indexOf("function fillRaw(");
const fillHelpersEnd = bundle.indexOf("function TaskQuestionCard(", fillHelpersStart);
if (fillHelpersStart < 0 || fillHelpersEnd < 0) throw new Error("Não foi possível localizar os auxiliares de lacunas no bundle");
const referenceStart = reference.indexOf("function raw(question)");
const referenceEnd = reference.indexOf("function renderFill(", referenceStart);
if (referenceStart < 0 || referenceEnd < 0) throw new Error("Não foi possível localizar o extrator de referência");
const referenceContext = { window: {}, document: { createElement: () => ({ set innerHTML(value) { this.textContent = value; }, textContent: "" }) } };
vm.runInNewContext(`${reference.slice(referenceStart, referenceEnd)}\nthis.gapChoices = gapChoices;`, referenceContext);
const fillContext = { window: { __sdfGapChoices: referenceContext.gapChoices } };
vm.runInNewContext(`${bundle.slice(fillHelpersStart, fillHelpersEnd)}\nthis.fillChoices = fillChoices; this.fillBuildAnswer = fillBuildAnswer; this.wordOrderNormalizeAnswer = wordOrderNormalizeAnswer; this.wordOrderBuildAnswer = wordOrderBuildAnswer;`, fillContext);
const answerHelpersStart = bundle.indexOf("function parseTaskAnswerJson(");
const answerHelpersEnd = bundle.indexOf("function QuestionAssist(", answerHelpersStart);
if (answerHelpersStart < 0 || answerHelpersEnd < 0) throw new Error("Não foi possível localizar os validadores das respostas da IA");
vm.runInNewContext(`${bundle.slice(answerHelpersStart, answerHelpersEnd)}\nthis.parseTaskAnswerJson = parseTaskAnswerJson; this.createTaskAnswerPrompt = createTaskAnswerPrompt; this.buildTaskAnswer = buildTaskAnswer;`, fillContext);
assert.deepEqual(Array.from(fillContext.fillChoices({ raw: { options: { phrase: [
  { value: "A água", fixed: true },
  { value: "líquido", fixed: false, answer: "líquido" },
] } } })), ["líquido"]);
assert.deepEqual(Array.from(fillContext.fillChoices({ raw: { content: { question: { options: {
  phrase: [{ value: "Meios de", fixed: true }, { value: "", fixed: false }],
  wordOptions: ["transporte", { label: "comunicação" }],
} } } } })), ["transporte", "comunicação"]);
assert.deepEqual(Array.from(fillContext.fillBuildAnswer({ 1: "gasoso", 0: "líquido" })), ["líquido", "gasoso"]);
assert.deepEqual(Array.from(fillContext.fillChoices({ raw: { options: { choices: ["pesquisa", "comunicação", "transporte"] } } })), ["pesquisa", "comunicação", "transporte"]);
const orderBank = ["A", "vida", "regionalista", "romântica", "representava", "o", "modo", "de", "prosa", "sertanejo."];
assert.deepEqual(Array.from(fillContext.fillChoices(orderedQuestions[0])), orderBank);
const orderedAnswer = ["A", "prosa", "regionalista", "romântica", "representava", "o", "modo", "de", "vida", "sertanejo."];
assert.deepEqual(Array.from(fillContext.wordOrderNormalizeAnswer(orderedAnswer, orderBank)), orderedAnswer, "A resposta ordenada mantém a grafia original do banco");
assert.deepEqual(Array.from(fillContext.wordOrderNormalizeAnswer("A prosa regionalista romantica representava o modo de vida sertanejo.", orderBank)), orderedAnswer, "A resposta textual da IA deve ser convertida em palavras do banco");
assert.deepEqual(Array.from(fillContext.wordOrderBuildAnswer(orderedAnswer)), orderedAnswer);
assert.ok(bundle.includes('answer:fillBuildAnswer(P[L.id])'), "Questões de lacunas devem usar o campo answer como array ordenado");
assert.ok(bundle.includes('value:wordOrderBuildAnswer(P[L.id])'), "Questões de ordenação devem enviar as palavras na sequência escolhida");
assert.ok(bundle.includes('className:"word-order-choice'), "A questão de ordenação deve renderizar as palavras como controles selecionáveis");
assert.ok(bundle.includes('?!String(a.rawType||"").toLowerCase().includes("fill-words")&&!b.length?jsxRuntimeExports.jsx("input"'), "fill-words deve usar seleção mesmo quando o parser não encontrou opções");
assert.ok(bundle.includes('jsxRuntimeExports.jsx("select",{className:"fill-word-gap"'), "As lacunas devem oferecer um controle de seleção");
assert.ok(!bundle.includes("fillAnswerValues"), "O renderizador não deve chamar uma função inexistente");

const toPlain = (value) => JSON.parse(JSON.stringify(value));
assert.deepEqual(toPlain(fillContext.parseTaskAnswerJson('```json\n{"selected_ids":["op-b"]}\n```')), { selected_ids: ["op-b"] });
assert.equal(fillContext.buildTaskAnswer({ type: "single", options: [{ id: "op-a" }, { id: "op-b" }] }, { selected_ids: ["op-b"] }), "op-b");
assert.throws(() => fillContext.buildTaskAnswer({ type: "single", options: [{ id: "op-a" }] }, { selected_ids: ["invalid"] }), /alternativas/);
assert.deepEqual(Array.from(fillContext.buildTaskAnswer({ type: "multi", options: [{ id: "a" }, { id: "b" }, { id: "c" }] }, { selected_ids: ["a", "c"] })), ["a", "c"]);
assert.deepEqual(toPlain(fillContext.buildTaskAnswer({ type: "true-false", id: "q5", options: [{ id: "a" }, { id: "b" }] }, { true_false: { a: true, b: false } })), { a: true, b: false });
const wordOrderPrompt = fillContext.createTaskAnswerPrompt(orderedQuestions[0]);
assert.ok(wordOrderPrompt.includes('"word_bank"'), "O prompt da IA deve receber o banco de palavras da questão");
assert.ok(wordOrderPrompt.includes("frase completa, natural e coerente em português brasileiro"), "A IA deve priorizar uma frase gramatical e coerente");
assert.ok(wordOrderPrompt.includes("não preserve sua ordem original"), "A IA não deve simplesmente reutilizar a ordem embaralhada do banco");
assert.ok(wordOrderPrompt.includes("sujeito e verbo devem formar uma oração"), "O prompt deve exigir uma revisão sintática antes da resposta");
assert.deepEqual(toPlain(fillContext.buildTaskAnswer(orderedQuestions[0], { word_order: ["A", "prosa", "regionalista", "romântica", "representava", "o", "modo", "de", "vida", "sertanejo."] })), orderedAnswer, "O exemplo da captura deve aceitar a frase gramatical completa");
assert.deepEqual(toPlain(fillContext.buildTaskAnswer(orderedQuestions[0], { word_order: orderedAnswer })), orderedAnswer, "A IA deve retornar a sequência validada do banco");
assert.throws(() => fillContext.buildTaskAnswer(orderedQuestions[0], { word_order: ["palavra inventada"] }), /fora do banco/);

const twoGapQuestion = {
  id: "q-fill",
  type: "fill",
  rawType: "fill-words",
  statement: "Complete a frase:",
  raw: { options: { phrase: [
    { value: "A base compreende", fixed: true },
    { value: "", fixed: false },
    { value: " e", fixed: true },
    { value: "", fixed: false },
  ], choices: ["comunicação", "pesquisa"] } },
};
assert.deepEqual(toPlain(fillContext.buildTaskAnswer(twoGapQuestion, { fill_words: ["COMUNICACAO", "Pesquisa"] })), { 1: "comunicação", 3: "pesquisa" });
assert.throws(() => fillContext.buildTaskAnswer(twoGapQuestion, { fill_words: ["fora do banco", "pesquisa"] }), /fora do banco/);
const noBankQuestion = { ...twoGapQuestion, raw: { options: { phrase: [{ value: "A resposta", fixed: true }, { value: "", fixed: false }] } } };
assert.deepEqual(toPlain(fillContext.buildTaskAnswer(noBankQuestion, { fill_words: ["inferida"] })), { 1: "inferida" });
assert.equal(fillContext.buildTaskAnswer({ type: "text" }, { text_answer: "Resposta final." }), "Resposta final.");
assert.ok(fillContext.createTaskAnswerPrompt(twoGapQuestion).includes('"word_bank":["comunicação","pesquisa"]'));
assert.ok(fillContext.createTaskAnswerPrompt(noBankQuestion).includes("Infira a palavra"));

const assistStart = bundle.indexOf("function QuestionAssist(");
const assistEnd = bundle.indexOf("function QuestionText(", assistStart);
const assistSource = bundle.slice(assistStart, assistEnd);
assert.ok(assistSource.includes("Selecionar respostas com IA"), "O botão deve iniciar a seleção automática");
assert.ok(!assistSource.includes("Não escolha alternativa"), "O prompt não deve impedir a seleção das respostas");
assert.ok(assistSource.includes("update(answer)"), "A resposta validada deve atualizar os controles da questão");
assert.ok(assistSource.includes('request("/groq-chat"'), "A seleção deve consumir a resposta JSON bruta do endpoint");
assert.ok(!assistSource.includes("sendAssistantMessage"), "A seleção não deve passar pelo filtro textual do tutor");
assert.ok(bundle.includes('i.map(l=>jsxRuntimeExports.jsx("option"'), "Palavras inferidas pela IA devem aparecer como opção selecionada no controle da lacuna");
assert.equal((bundle.match(/QuestionAssist,\{question:a,onChange:o\}/g) || []).length, 4, "Todas as questões respondíveis devem receber o atualizador de resposta");

console.log("OK: lacunas, seleções simples/múltiplas, certo/errado e respostas escritas são validadas e aplicadas pela IA.");
