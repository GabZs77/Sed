# Notificações push do SedX

## Componentes

- `site-state.js`: apresenta o controle de ativação/desativação na Central de notificações; a permissão do navegador só é solicitada após o clique.
- `service-worker.js`: exibe push recebido e direciona o clique de volta ao site.
- `push-worker.mjs`: rotas de inscrição/desinscrição, cifragem de sessão, VAPID, envio Web Push e rotina agendada.
- `push-notifications.css`: estilos responsivos do controle.
- `migrate-push-notifications.sql`: migração idempotente do D1.

## Integração no Worker `sdf`

O módulo principal importa `handlePushRoute` e `runPushScheduled` de `push-worker.mjs`. As rotas `/push/config`, `/push/subscribe` e `/push/unsubscribe` são encaminhadas a `handlePushRoute`; o `scheduled(controller, env)` chama `runPushScheduled(controller, env, { fetchAgendaDia })`.

Depois que um novo aviso é salvo na tabela `notifications`, a rotina agendada procura avisos ainda não entregues a cada aluno inscrito e grava a chave `(user_ra, notice_id)` em `push_notice_deliveries`. Isso deduplica o envio e evita que a publicação dependa do limite de subrequisições da requisição administrativa.

## Requisitos de configuração (nomes somente)

- D1: `SEDX_ADMIN`.
- Secrets do Worker: `PUSH_VAPID_PRIVATE_JWK` e `PUSH_SESSION_ENCRYPTION_KEY`.
- Cron Trigger: `* * * * *` (Cloudflare executa crons em UTC; a decisão de aula usa o fuso horário armazenado por dispositivo, com fallback `America/Sao_Paulo`).

Não compartilhe nem registre os valores dos secrets. O segredo AES-GCM guarda a sessão necessária para consultar a agenda; quando o último dispositivo é desativado, a sessão cifrada é apagada.

## Regras dos avisos

- Um push por aviso novo para cada aluno/dispositivo inscrito; alterações posteriores no mesmo aviso não repetem o push.
- Lembrete de aula: somente de segunda a sexta, uma hora antes da primeira aula do dia; no máximo um por aluno por data.
- A rotina processa até cinco alunos por minuto para respeitar limites de execução/subrequisições. Com mais inscrições, a rodada dos usuários pode levar alguns minutos.
- O navegador precisa estar em HTTPS e o usuário precisa permitir notificações; a inscrição é específica para cada dispositivo/navegador.
