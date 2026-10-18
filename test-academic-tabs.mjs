import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const helperStart = bundle.indexOf("function asObject(");
const helperEnd = bundle.indexOf("function formatTaskDeadline(", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "normalizadores acadêmicos devem existir no bundle");
const helperContext = {};
vm.runInNewContext(`${bundle.slice(helperStart, helperEnd)}\nthis.normalizeGrades=normalizeGrades;this.filterGradesByPeriod=filterGradesByPeriod;this.normalizeAttendance=normalizeAttendance;`, helperContext);

const documentedGrade = helperContext.normalizeGrades({ data: [{
  componenteCurricularId: 42,
  nomeComponenteCurricular: "Matemática",
  notaAtribuida: "8,5",
  notaAtribuidaMediaFinal: "9,0",
  primeiroBimestre: true,
}] });
assert.equal(documentedGrade.length, 1);
assert.equal(documentedGrade[0].subject, "Matemática");
assert.equal(documentedGrade[0].grade, 8.5);
assert.equal(documentedGrade[0].average, 9);
assert.equal(documentedGrade[0].period, "1º Bimestre");

const yearGrades = helperContext.filterGradesByPeriod([
  { id: "math-q1", subject: "Matemática", description: "2º ano", grade: 8, average: 9, period: "1º Bimestre" },
  { id: "math-q2", subject: "Matemática", description: "2º ano", grade: 8, average: 9, period: "2º Bimestre" },
  { id: "port-q1", subject: "Português", description: "2º ano", grade: 7, average: null, period: "1º Bimestre" },
], "ano");
assert.equal(yearGrades.length, 1, "Ano letivo deve agrupar disciplina com média final disponível, em vez de filtrar para lista vazia");
assert.equal(yearGrades[0].subject, "Matemática");
assert.equal(yearGrades[0].average, 9);
assert.equal(yearGrades[0].period, "Ano letivo");
assert.equal(helperContext.filterGradesByPeriod(documentedGrade, "1").length, 1);

const rawFrequency = {
  frequencia: 88,
  faltas: 3,
  aulasDadas: 25,
  data: [
    { bimestre: 1, numeroPresencasBimestre: 10, numeroFaltasBimestre: 2, porcentagemPresenca: 83.3 },
    { bimestre: 2, numeroPresencasBimestre: 12, numeroFaltasBimestre: 1, porcentagemPresenca: 92.3 },
  ],
};
const attendance = helperContext.normalizeAttendance(rawFrequency);
assert.equal(attendance.frequency, 88);
assert.equal(attendance.absences, 3);
assert.equal(attendance.classes, 25);
assert.equal(attendance.periods.length, 2);
assert.equal(attendance.periods[0].attendance, 83.3);
assert.equal(attendance.periods[0].absences, 2);
assert.equal(attendance.periods[0].classes, 12, "aulas devem poder ser derivadas de presenças + faltas");
assert.equal(attendance.periods[0].label, "1º Bimestre");

const summaryFrequency = helperContext.normalizeAttendance({ data: [{ faltasBimestreAtual: 4, porcentagemPresencaBimestreAtual: 81.5 }] });
assert.equal(summaryFrequency.frequency, 81.5);
assert.equal(summaryFrequency.absences, 4);

const saturday = new Date(2026, 9, 17, 9);
const monday = new Date(2026, 9, 19, 12);
const agendaStart = bundle.indexOf("function sameDay(");
const agendaEnd = bundle.indexOf("function dayLabel(", agendaStart);
assert.ok(agendaStart >= 0 && agendaEnd > agendaStart, "helper de data da Agenda deve existir");
const agendaContext = {};
vm.runInNewContext(`${bundle.slice(agendaStart, agendaEnd)}\nthis.nextAgendaWorkday=nextAgendaWorkday;`, agendaContext);
assert.equal(agendaContext.nextAgendaWorkday(saturday).getDay(), 1, "sábado deve selecionar segunda-feira");
assert.equal(agendaContext.nextAgendaWorkday(new Date(2026, 9, 18, 9)).getTime(), monday.getTime(), "domingo deve selecionar a segunda-feira seguinte");
assert.equal(agendaContext.nextAgendaWorkday(new Date(2026, 9, 19, 7)).getDate(), 19, "dia útil deve permanecer selecionado");

const presencePage = bundle.slice(bundle.indexOf("function PresencaPage()"), bundle.indexOf("function BoletimPage()"));
const reportPage = bundle.slice(bundle.indexOf("function BoletimPage()"), bundle.indexOf("function GradeCard("));
assert.ok(presencePage.includes('fetchOptional("/presenca").then(g).finally(()=>w(false))'), "atualizar Presença deve refazer sua consulta detalhada");
assert.ok(reportPage.includes('fetchOptional("/boletim").then(g).finally(()=>h(false))'), "atualizar Boletim deve refazer sua consulta detalhada");
console.log("OK: Agenda seleciona próximo dia útil; Presença e Boletim mapeiam os campos SED e atualizam dados detalhados.");
