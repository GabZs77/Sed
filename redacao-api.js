/* Cliente isolado da aba Redação. Nenhum token é persistido ou registrado em logs. */
(function () {
  "use strict";
  var ENDPOINT = "https://sdf-redacoes.gabrielreplit56.workers.dev/essays";

  function essayList(payload) {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    if (Array.isArray(payload.items)) return payload.items;
    if (Array.isArray(payload.tasks)) return payload.tasks;
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
    return [];
  }

  window.__sedLoadEssays = async function (token) {
    if (typeof token !== "string" || !token.trim()) {
      throw new Error("Faça login novamente para consultar as redações.");
    }
    var response;
    try {
      response = await fetch(ENDPOINT + "?limit=100&offset=0", {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json", "X-Api-Key": token.trim() },
      });
    } catch (_) {
      throw new Error("Não foi possível conectar ao serviço de redações. Tente novamente.");
    }
    var payload;
    try { payload = await response.json(); } catch (_) { payload = null; }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error("A sessão do SED expirou ou não tem acesso às redações. Entre novamente e tente de novo.");
      }
      throw new Error(payload && (payload.erro || payload.error) || "Não foi possível carregar as redações agora.");
    }
    return essayList(payload).filter(function (item) {
      return item && typeof item === "object" && (item.is_essay === true || item.is_essay === 1 || item.is_essay === "true");
    });
  };
})();
