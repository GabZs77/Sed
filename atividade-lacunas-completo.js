/* EduX — somente questões de preenchimento de lacunas.
   Extraído do widget atual; sem ordenação, CAPTCHA ou envio.
   Uso: window.__sdfQuestionWidget(host, question, value, onChange)
   Payload: window.__sdfBuildAnswers(questions, values)
   Inclui os estilos sdf-fill-* e um exemplo ilustrativo de questão.
*/
(function () {
  var css = document.createElement("style");
  css.textContent = [
    ".sdf-fill-bank{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}",
    ".sdf-fill-bank-label{font:700 12px/1.3 'Manrope',sans-serif;color:#a8bed4;text-transform:uppercase;letter-spacing:.06em}",
    ".sdf-fill-chip{border-radius:999px;padding:6px 12px;background:rgba(74,222,128,.16);border:1px solid rgba(74,222,128,.45);color:#eafff2;font:600 13px/1.2 'DM Sans',sans-serif}",
    ".sdf-fill-phrase{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font:500 15px/2 'DM Sans',sans-serif;color:#e8f0fb;margin-top:12px}",

    ".sdf-fill-gap{min-width:120px;border-radius:10px;border:2px solid rgba(74,222,128,.75);background:rgba(15,23,42,.65);color:#eafff2;font:600 14px/1.2 'DM Sans',sans-serif;padding:8px 10px}",
    ".sdf-fill-gap:focus{outline:none;border-color:#4ade80;box-shadow:0 0 0 3px rgba(74,222,128,.22)}",
  ].join("");
  document.head.appendChild(css);

  function raw(question) {
    return (question && question.raw) || {};
  }
  function rawOptions(question) {
    var o = raw(question).options;
    return o && typeof o === "object" ? o : {};
  }
  function text(item, fallback) {
    if (item == null) return fallback || "";
    if (typeof item === "string" || typeof item === "number") return String(item);
    return String(item.value != null ? item.value
      : item.text != null ? item.text
      : item.statement != null ? item.statement
      : item.label != null ? item.label
      : fallback || "");
  }
  function stripTags(s) {
    var d = document.createElement("div");
    d.innerHTML = String(s == null ? "" : s);
    return (d.textContent || "").trim();
  }

  // Segmentos da frase com lacunas: [{gap:false,text}, {gap:true,key}]
  function phraseSegments(question) {
    var opts = rawOptions(question);
    var arr = [opts.phrase, opts.sentences, opts.words, opts.items, raw(question).phrase]
      .find(function (a) { return Array.isArray(a) && a.length; });
    if (!arr) {
      // fallback: lacunas marcadas no enunciado com ___ ou [[...]]
      var statement = stripTags(question.statement);
      var parts = statement.split(/_{2,}|\[\[.*?\]\]/g);
      if (parts.length < 2) return null;
      var segs = [];
      parts.forEach(function (p, i) {
        segs.push({ gap: false, text: p });
        if (i < parts.length - 1) segs.push({ gap: true, key: String(segs.length) });
      });
      return segs;
    }
    return arr.map(function (item, i) {
      var t = text(item, "");
      var isGap =
        (item && typeof item === "object" && (item.fixed === false || item.gap === true || item.blank === true || item.type === "blank")) ||
        t === "" || /^_{2,}$/.test(t);
      return isGap ? { gap: true, key: String(i) } : { gap: false, text: t };
    });
  }

  // Palavras oferecidas pela atividade para preencher as lacunas.
  // O app oficial só abre a tarefa se as lacunas guardarem exatamente essas
  // palavras, por isso reunimos todas as listas possíveis do JSON da questão.
  function gapChoices(question) {
    var opts = rawOptions(question);
    var r = raw(question);
    var pools = [
      opts.options, opts.choices, opts.words, opts.alternativas, opts.opcoes,
      opts.answers, opts.answer, opts.bank, opts.word_bank, opts.wordBank,
      opts.gaps, opts.blanks, opts.terms, opts.tokens,
      r.words, r.choices, r.word_bank, r.wordBank, r.bank, r.answers,
      question.words, question.choices,
    ];
    var out = [];
    var seen = {};
    function push(value) {
      var t = stripTags(text(value, ""));
      if (!t || /^_{2,}$/.test(t)) return;
      var key = t.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(t);
    }
    pools.forEach(function (pool) {
      if (Array.isArray(pool)) pool.forEach(push);
      else if (pool && typeof pool === "object") Object.keys(pool).forEach(function (k) { push(pool[k]); });
      else if (typeof pool === "string" && pool.indexOf(";") > 0) pool.split(";").forEach(push);
    });
    // Alguns pacotes trazem a palavra dentro do próprio item da lacuna.
    var phrase = [opts.phrase, opts.sentences, opts.items, r.phrase].find(function (a) { return Array.isArray(a) && a.length; });
    if (phrase) {
      phrase.forEach(function (item) {
        if (!item || typeof item !== "object") return;
        var isGap = item.fixed === false || item.gap === true || item.blank === true || item.type === "blank";
        if (!isGap) return;
        [item.answer, item.correct, item.word, item.value, item.text].forEach(function (v) {
          if (Array.isArray(v)) v.forEach(push);
          else if (v != null && v !== "") push(v);
        });
      });
    }
    return out;
  }


  function renderFill(host, question, value, onChange) {
    var segs = phraseSegments(question) || [];
    var choices = gapChoices(question);
    var gapKeys = segs.filter(function (s) { return s.gap; }).map(function (s) { return s.key; });
    var current = {};
    if (Array.isArray(value)) gapKeys.forEach(function (k, i) { current[k] = value[i]; });
    else if (value && typeof value === "object") current = value;

    if (choices.length) {
      var bank = document.createElement("div");
      bank.className = "sdf-fill-bank";
      var lab = document.createElement("span");
      lab.className = "sdf-fill-bank-label";
      lab.textContent = "Palavras disponíveis:";
      bank.appendChild(lab);
      choices.forEach(function (c) {
        var chip = document.createElement("span");
        chip.className = "sdf-fill-chip";
        chip.textContent = c;
        bank.appendChild(chip);
      });
      host.appendChild(bank);
    }

    var wrap = document.createElement("div");
    wrap.className = "sdf-fill-phrase";
    segs.forEach(function (seg) {
      if (!seg.gap) {
        if (!seg.text) return;
        var span = document.createElement("span");
        span.textContent = seg.text;
        wrap.appendChild(span);
        return;
      }
      var field;
      if (choices.length) {
        field = document.createElement("select");
        var empty = document.createElement("option");
        empty.value = "";
        empty.textContent = "—";
        field.appendChild(empty);
        choices.forEach(function (c) {
          var op = document.createElement("option");
          op.value = c;
          op.textContent = c;
          field.appendChild(op);
        });
      } else {
        field = document.createElement("input");
        field.type = "text";
        field.placeholder = "lacuna";
      }
      field.className = "sdf-fill-gap";
      field.dataset.sdfGap = seg.key;
      field.value = current[seg.key] != null ? current[seg.key] : "";
      field.addEventListener("change", commit);
      field.addEventListener("input", commit);
      wrap.appendChild(field);
    });

    host.__sdfGapKeys = gapKeys;

    function commit() {
      var next = {};
      wrap.querySelectorAll("[data-sdf-gap]").forEach(function (el) {
        next[el.dataset.sdfGap] = el.value;
      });
      host.__sdfValue = next;
      host.__sdfChange(next);
    }

    host.appendChild(wrap);
  }



  window.__sdfQuestionWidget = function (host, question, value, onChange) {
    if (!host || !question || question.type !== "fill") return;
    host.__sdfChange = function (v) { try { onChange(v); } catch (e) { /* noop */ } };
    if (host.dataset.sdfWidget) return;
    host.dataset.sdfWidget = question.type;
    host.innerHTML = "";
    renderFill(host, question, value, onChange);
  };

  function buildFillAnswer(value) {
    if (Array.isArray(value)) return value.map(function (v) { return String(v == null ? "" : v); });
    var src = value && typeof value === "object" ? value : {};
    return Object.keys(src)
      .sort(function (a, b) { return Number(a) - Number(b); })
      .map(function (k) { return String(src[k] == null ? "" : src[k]); });
  }

  window.__sdfBuildAnswers = function (questions, values) {
    var payload = {};
    (questions || []).forEach(function (q) {
      if (q.type !== "fill") return;
      payload[q.id] = {
        question_id: q.id,
        question_type: q.rawType || q.type,
        answer: buildFillAnswer(values ? values[q.id] : undefined),
      };
    });
    return payload;
  };
})();

/* EXEMPLO ILUSTRATIVO — não é uma questão real retornada pela API.
   O leitor atual do EduX fornece a questão já normalizada:
   type: "fill"; rawType: tipo original; raw: dados originais.

const question = {
  id: 123,
  type: "fill",
  rawType: "fill-words",
  statement: "Complete a frase:",
  raw: {
    options: {
      phrase: [
        { value: "A água pode estar no estado", fixed: true },
        { value: "", fixed: false },
        { value: ".", fixed: true }
      ],
      choices: ["sólido", "líquido", "gasoso"]
    }
  }
};

// Execute depois de criar um elemento com id="questao-lacunas".
const host = document.getElementById("questao-lacunas");
const values = {};
if (host) {
  window.__sdfQuestionWidget(host, question, undefined, function (value) {
    values[question.id] = value;
    // A seleção atual fica em values[123].
  });
}

// Depois de o usuário escolher uma palavra:
const payload = window.__sdfBuildAnswers([question], values);
// Exemplo de saída se a escolha for "líquido":
// { "123": { question_id: 123, question_type: "fill-words", answer: ["líquido"] } }

// Este arquivo não busca atividades, não valida acertos e não envia respostas.
// Não carregue junto ao widget original: ambos expõem as mesmas funções globais.
*/
