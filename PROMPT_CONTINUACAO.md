Use `STATUS.md` deste repositorio como guia completo do que ja foi feito.

Antes de qualquer nova alteracao:
- leia `STATUS.md` inteiro
- considere que a ultima mudanca importante desta sessao foi em `src/routes/tiktok.js`
- preserve a degradacao segura quando TikTok OAuth nao estiver configurado

Pastas/arquivos mexidos recentemente:
- `src/routes/tiktok.js`

Objetivo desta continuidade:
- manter o backend subindo sem crash por falta de credenciais TikTok
- usar `STATUS.md` como fonte principal de contexto
- se for mexer em testes, lembrar que a falha atual conhecida esta na suite `e2e/tests/*.spec.js`
