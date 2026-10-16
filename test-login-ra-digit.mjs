import assert from "node:assert/strict";
import fs from "node:fs";

const bundle = fs.readFileSync(new URL("./script.js", import.meta.url), "utf8");
const digitFieldStart = bundle.indexOf('aria-label":"Dígito do RA"');
assert.notEqual(digitFieldStart, -1, "O campo Dígito do RA deve existir no formulário de login.");
const digitField = bundle.slice(digitFieldStart, digitFieldStart + 350);
assert.ok(digitField.includes('inputMode:"text"'), "O teclado do campo deve permitir letras.");
assert.ok(digitField.includes('autoCapitalize:"characters"'), "Letras do dígito devem ser convertidas para maiúsculas no celular.");
assert.ok(digitField.includes('replace(/[^0-9A-Z]/g,"").slice(0,2)'), "O campo deve aceitar caracteres alfanuméricos e manter o limite existente.");
assert.ok(bundle.includes('const P=`${f.trim()}${b.trim()}${_.trim().toUpperCase()}`'), "O login deve enviar o dígito informado sem convertê-lo em número.");
assert.ok(!digitField.includes('replace(/\\D/g,""'), "O filtro do dígito não deve remover letras.");
console.log("OK: dígito alfanumérico do RA é aceito, normalizado para maiúsculas e preservado no login.");
