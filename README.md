# SED Aluno

Versão estática do painel acadêmico SED Aluno, com agenda, presença, boletim, tarefas, leitor de apostilas e assistente de IA.

## Arquivos principais

- `index.html`: entrada da aplicação.
- `style.css`: estilos compilados.
- `script.js`: aplicação compilada em modo de produção.
- `admin-panel.js`: painel administrativo restrito aos RAs autorizados, com gestão de usuários, avisos, configurações, auditoria, manutenção e temas sazonais globais.
- `site-state.js`: central pública de notificações, temas sazonais, rota `/admin-tab` e bloqueio de manutenção para usuários comuns.
- `seasonal-themes.css`: paletas e efeitos visuais de Halloween, Natal e Dia das crianças.
- `platforms-tab.js` e `platforms-tab.css`: navegação e apresentação da plataforma LeiaSP; reutilizam o token SED da sessão e encaminham a autenticação pelo Worker.
- `sedx-admin-schema.sql`: schema versionado do banco D1 administrativo.
- `worker.js`: proxy Cloudflare com identificação oficial de sala por aluno.
- `EF/` e `EM/`: apostilas PDF mantidas no repositório.

## Configuração do Worker

As chaves de upstream e do provedor de IA não são incluídas neste repositório público. Configure os seguintes secrets no Cloudflare Worker antes de publicar o `worker.js`: `SED_LOGIN_SUBSCRIPTION_KEY`, `SED_TURMAS_SUBSCRIPTION_KEY` (ou a de login), `SED_ALUNO_SUBSCRIPTION_KEY`, `SED_BOLETIM_SUBSCRIPTION_KEY`, `SED_HUB_SUBSCRIPTION_KEY` e `GROQ_API_KEY`. Nunca coloque tokens, senhas, cookies ou arquivos `.env` no GitHub. O arquivo de captura de rede mantido no repositório contém apenas valores sensíveis redigidos.

## Correção da obtenção da sala do aluno

A rota `GET /student-rooms` e a carga do dashboard usam o endpoint oficial `ListarTurmasPorAluno`. Esse endpoint exige simultaneamente o `codigoAluno` curto e o cabeçalho `Authorization: Bearer <token>` da sessão SED. O Worker estava enviando apenas a subscription key, por isso a API upstream rejeitava a consulta e o frontend não conseguia identificar a sala.

A correção em `worker.js` agora envia o token SED, inclui `x-product-name: SalaDoFuturo` e normaliza automaticamente o `CD_USUARIO` completo de 9 dígitos para o código curto de 8 dígitos usado pelas APIs de turma e aluno. A rota direta também valida a existência de `X-Token` e devolve o diagnóstico do upstream quando a API falha.

Foi validado o fluxo com um teste isolado que confirma a conversão de `301953746` para `30195374`, a montagem correta da URL e o envio do Bearer token.

## Administração SedX

A aba **Administração** aparece somente para os RAs administrativos configurados (`1127620514SP` e `1127241606SP`). Também é possível acessar diretamente `/admin-tab`: a tela de login padrão é exibida e, depois de um login válido, o painel administrativo é aberto sem aplicar a tela de manutenção aos administradores. A rota antiga `/admin` continua aceita como compatibilidade e é direcionada para `/admin-tab` após a autenticação.

As notificações, configurações, manutenção, usuários e auditoria agora são persistidas no banco **Cloudflare D1 `sedx-admin`**, através das rotas administrativas do Worker `sdf`. Usuários comuns consultam as notificações pelo botão de sino na dashboard. Quando o administrador ativa a manutenção, todos os usuários comuns recebem a tela “O SedX está em manutenção”; a rota `/admin-tab` permanece disponível para os administradores.

As rotas administrativas exigem o RA autorizado, `X-Token2` da sessão oficial e são gravadas no log de auditoria. O Worker mantém o binding D1 `SEDX_ADMIN` e o schema das tabelas `notifications`, `site_settings`, `admin_users` e `audit_logs`.

A aba **Tema** permite escolher entre o visual Original, Halloween, Natal e Dia das crianças. A seleção fica salva em `site_settings.activeTheme` e é publicada pela rota pública `/site-state` para sincronizar todos os dispositivos; partículas e elementos decorativos respeitam a preferência por movimento reduzido do navegador.

A aba **Plataformas** adiciona o LeiaSP à navegação do aluno. O botão envia o token SED da sessão atual por POST ao Worker; o Worker obtém o JWT do LeiaSP e segue o fluxo OAuth do cliente Python, repassando somente o redirecionamento HTTPS para o domínio oficial do leitor. O token de acesso do LeiaSP não é persistido pelo SedX.
