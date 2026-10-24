(() => {
  const title = "Tempo da tarefa concluído";

  window.sedxNotifyTaskTimer = async (timer, body) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;

    const options = {
      body: String(body || "O tempo da tarefa terminou. Volte à atividade para revisar e enviar."),
      icon: "/icon-192.png",
      badge: "/favicon-32.png",
      tag: `sed-task-${String(timer?.taskId || "timer")}`,
      renotify: false,
      data: { url: "/tarefas" },
    };

    if ("serviceWorker" in navigator) {
      try {
        const registration = await navigator.serviceWorker.getRegistration("/")
          || await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
        await registration.showNotification(title, options);
        return true;
      } catch {
        // Se o navegador não oferecer exibição pelo service worker, usa o fallback abaixo.
      }
    }

    try {
      const notification = new Notification(title, options);
      notification.onclick = () => {
        window.focus();
        notification.close();
      };
      return true;
    } catch {
      return false;
    }
  };
})();
