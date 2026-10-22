# SED Aluno

Versão estática do painel acadêmico SED Aluno, com agenda, presença, boletim, tarefas, leitor de apostilas e assistente de IA.

## Arquivos principais

- `index.html`: entrada da aplicação.
- `style.css`: estilos compilados.
- `script.js`: aplicação compilada em modo de produção.
- `admin-panel.js`: painel administrativo restrito aos RAs autorizados, com gestão de usuários, avisos, configurações, auditoria, manutenção e temas sazonais globais.
- `site-state.js`: central pública de notificações, temas sazonais, rota `/admin-tab` e bloqueio de manutenção para usuários comuns.
- `seasonal-themes.css`: paletas e efeitos visuais de Halloween, Natal e Dia das crianças.
- `tools-tab.js`, `tools-tab.css` e `mobile-navigation.css`: navegação pelo menu lateral, publicação administrativa e remoção da barra de abas inferior em dispositivos móveis.
- `sedx-admin-schema.sql`: schema versionado do banco D1 administrativo.
- Worker Cloudflare `sdf`: proxy da aplicação e API administrativa; o código ativo é gerenciado no Cloudflare.
- `EF/` e `EM/`: apostilas PDF mantidas no repositório.

## Configuração do Worker

As chaves de upstream e do provedor de IA não são incluídas neste repositório público. Configure os secrets necessários diretamente no Cloudflare Worker. Nunca coloque tokens, senhas, cookies ou arquivos `.env` no GitHub. O arquivo de captura de rede mantido no repositório contém apenas valores sensíveis redigidos.

## Correção da obtenção da sala do aluno

A rota `GET /student-rooms` e a carga do dashboard usam o endpoint oficial `ListarTurmasPorAluno`. Esse endpoint exige simultaneamente o `codigoAluno` curto e o cabeçalho `Authorization: Bearer <token>` da sessão SED. O Worker envia o token da sessão, inclui `x-product-name: SalaDoFuturo` e normaliza o `CD_USUARIO` para o código usado pelas APIs de turma e aluno.

## Fluxo do CAPTCHA e abertura de tarefas

O desafio (`POST /captcha/challenge`), a validação (`POST /captcha/verify`) e a abertura da tarefa (`GET /task-details`) passam pelo Worker Cloudflare `sdf`. O mesmo `sessionKey` e cookie temporário acompanham o token do CAPTCHA entre a validação, a consulta do enunciado e o envio das respostas; nenhuma etapa desse fluxo é desviada por uma função Vercel.

## Confirmação de correções de tarefas

A aba **Tarefas** substitui o resumo **Expiradas** por **Correção Atividade**. A rota Vercel `GET /api/edusp-agreements` consulta respostas com `pending_agreement` e retorna somente os IDs necessários, sem enviar conteúdo das respostas ao navegador. `PUT /api/edusp-agreements` revalida a lista pendente e encaminha `{"agreed":true}` ao endpoint oficial por questão. A interface mostra a quantidade e pede confirmação explícita antes de qualquer alteração. A chave de sessão é encaminhada somente ao upstream e não é armazenada nem registrada.

## Administração SedX

A aba **Administração** aparece somente para os RAs administrativos configurados. Também é possível acessar diretamente `/admin-tab`: a tela de login padrão é exibida e, depois de um login válido, o painel administrativo é aberto sem aplicar a tela de manutenção aos administradores.

As notificações, configurações, manutenção, usuários e auditoria são persistidas no banco **Cloudflare D1 `sedx-admin`**, através das rotas administrativas do Worker `sdf`. Usuários comuns consultam as notificações pelo botão de sino na dashboard. Quando o administrador ativa a manutenção, todos os usuários comuns recebem a tela “O SedX está em manutenção”; a rota `/admin-tab` permanece disponível para os administradores.

As rotas administrativas exigem o RA autorizado e `X-Token2` da sessão oficial, e as operações são registradas no log de auditoria. O binding D1 é `SEDX_ADMIN`; o schema inclui as tabelas `notifications`, `site_settings`, `admin_users`, `audit_logs`, `site_metrics`, `published_tools` e `published_partnerships`.

A aba **Tema** permite escolher entre o visual Original, Halloween, Natal e Dia das crianças. A seleção fica salva em `site_settings.activeTheme` e é publicada pela rota pública `/site-state` para sincronizar todos os dispositivos; partículas e elementos decorativos respeitam a preferência por movimento reduzido do navegador.

## Ferramentas

A aba **Ferramentas** lista conteúdos publicados para os alunos. Administradores autorizados veem o botão **Publicar**, com campos de título, descrição, conteúdo e imagem opcional; podem escolher se o botão público será **Copiar** o conteúdo ou **Ir para o site**. Conteúdo de copiar é tratado como texto e nunca executado como código.

As publicações são persistidas em D1 na tabela `published_tools` e sincronizadas pela rota pública `/site-state`. A criação usa `POST /admin/tools`, protegida pela mesma autorização administrativa e auditoria do Worker. Imagens são otimizadas no navegador e limitadas a 250 KB. Esta aba não executa autenticação em plataformas externas.

## Parcerias

A aba **Parcerias** usa um ícone de handshake e lista as parcerias publicadas para todos os alunos. Administradores autorizados podem criar e editar parcerias com título, descrição, link de destino e tipo (**Discord**, **WhatsApp** ou **Outro**), além de logo e banner opcionais. Antes de publicar uma parceria nova ou um rascunho, o administrador confere a pré-visualização; parcerias publicadas podem ser despublicadas, e a exclusão pede confirmação.

As parcerias são persistidas em D1 na tabela `published_partnerships`. `GET /partnerships` retorna apenas itens publicados; leitura e alterações administrativas usam rotas protegidas pelo mesmo RA e sessão oficial do Worker (`GET/POST/DELETE /admin/partnerships` e `PUT /admin/partnerships/status`). As ações administrativas são auditadas. Logo e banner são otimizados no navegador e limitados a 250 KB cada. A interface apresenta mensagens explícitas de sucesso e erro.
