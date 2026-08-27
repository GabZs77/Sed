# SED Aluno

Versão estática do painel acadêmico SED Aluno, com agenda, presença, boletim, tarefas, leitor de apostilas e assistente de IA.

## Arquivos principais

- `index.html`: entrada da aplicação.
- `style.css`: estilos compilados.
- `script.js`: aplicação compilada em modo de produção.
- `worker.js`: proxy Cloudflare com identificação oficial de sala por aluno.
- `EF/` e `EM/`: apostilas PDF mantidas no repositório.

## Configuração do Worker

As chaves de upstream e do provedor de IA não são incluídas neste repositório público. Configure-as como secrets no Cloudflare Worker antes de publicar o `worker.js`, usando os nomes esperados pelo código. Nunca coloque tokens, senhas ou arquivos `.env` no GitHub.
