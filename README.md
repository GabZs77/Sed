# SED Aluno

Versão estática do painel acadêmico SED Aluno, com agenda, presença, boletim, tarefas, leitor de apostilas e assistente de IA.

## Arquivos principais

- `index.html`: entrada da aplicação.
- `style.css`: estilos compilados.
- `script.js`: aplicação compilada em modo de produção.
- `worker.js`: proxy Cloudflare com identificação oficial de sala por aluno.
- `EF/` e `EM/`: apostilas PDF mantidas no repositório.

## Configuração do Worker

As chaves de upstream e do provedor de IA não são incluídas neste repositório público. Configure os seguintes secrets no Cloudflare Worker antes de publicar o `worker.js`: `SED_LOGIN_SUBSCRIPTION_KEY`, `SED_ALUNO_SUBSCRIPTION_KEY`, `SED_BOLETIM_SUBSCRIPTION_KEY`, `SED_HUB_SUBSCRIPTION_KEY` e `GROQ_API_KEY`. Nunca coloque tokens, senhas, cookies ou arquivos `.env` no GitHub. O arquivo de captura de rede mantido no repositório contém apenas valores sensíveis redigidos.

## Correção da obtenção da sala do aluno

A rota `GET /student-rooms` e a carga do dashboard usam o endpoint oficial `ListarTurmasPorAluno`. Esse endpoint exige simultaneamente o `codigoAluno` curto e o cabeçalho `Authorization: Bearer <token>` da sessão SED. O Worker estava enviando apenas a subscription key, por isso a API upstream rejeitava a consulta e o frontend não conseguia identificar a sala.

A correção em `worker.js` agora envia o token SED, inclui `x-product-name: SalaDoFuturo` e normaliza automaticamente o `CD_USUARIO` completo de 9 dígitos para o código curto de 8 dígitos usado pelas APIs de turma e aluno. A rota direta também valida a existência de `X-Token` e devolve o diagnóstico do upstream quando a API falha.

Foi validado o fluxo com um teste isolado que confirma a conversão de `301953746` para `30195374`, a montagem correta da URL e o envio do Bearer token.
