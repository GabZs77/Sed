/* Isolated reader for nested EduSP word banks; keeps the app bundle unchanged. */
(function () {
  var fields = /^(options?|choices?|words?|word_options|wordOptions|word_list|wordList|available_words|availableWords|word_bank|wordBank|bank|alternatives?|alternativas|opcoes|terms|tokens|answers?|correct|respostas?)$/i;
  var containers = /^(raw|content|question|data|payload|items|gaps|blanks)$/i;
  function choices(question) {
    var out = [], seen = new Set(), visited = new Set();
    function add(value) {
      if (value == null || typeof value === 'boolean') return;
      if (Array.isArray(value)) { value.forEach(add); return; }
      if (typeof value === 'object') {
        var label = value.text ?? value.label ?? value.word ?? value.name ?? value.statement ?? value.value;
        if (label != null) add(label);
        else Object.keys(value).forEach(function (key) { if (!/^(id|key|index|fixed|type|score)$/i.test(key)) add(value[key]); });
        return;
      }
      var node = document.createElement('div');
      node.innerHTML = String(value);
      var word = (node.textContent || '').trim();
      if (!word || /^_{2,}$/.test(word) || seen.has(word)) return;
      seen.add(word); out.push(word);
    }
    function walk(value, offered) {
      if (value == null) return;
      if (typeof value !== 'object') { if (offered) add(value); return; }
      if (visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) { value.forEach(function (item) { walk(item, offered); }); return; }
      if (value.fixed === true || value.fixed === 1 || value.fixed === 'true') return;
      var gap = value.fixed === false || value.fixed === 0 || value.fixed === 'false' || value.gap === true || value.blank === true || value.type === 'blank';
      if (offered && !Object.keys(value).some(function (key) { return fields.test(key) || /^(phrase|sentences)$/i.test(key); })) add(value);
      Object.keys(value).forEach(function (key) {
        var child = value[key];
        if (fields.test(key)) walk(child, true);
        else if (/^(phrase|sentences)$/i.test(key)) walk(child, false);
        else if (containers.test(key)) walk(child, offered);
        else if (gap && /^(value|text|word|label)$/i.test(key)) add(child);
        else if (offered && /^\d+$/.test(key)) walk(child, true);
      });
    }
    walk(question && question.raw ? question.raw : question, false);
    if (question) ['words', 'choices', 'word_bank'].forEach(function (key) { walk(question[key], true); });
    return out;
  }
  window.__sdfGapChoices = choices;
})();
