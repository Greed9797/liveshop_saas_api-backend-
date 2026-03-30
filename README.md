# LiveShop SaaS — Backend (API)

API REST em Fastify para o SaaS multi-tenant de gestão de franquias de Live Shop (TikTok Live).
Gerencia faturamento, cabines ao vivo, produtos vendidos, contratos e dashboards por tenant.

## Stack

- Node.js + Fastify
- PostgreSQL via Supabase (RLS por tenant_id)
- node-cron (agendador TikTok a cada 60s)
- JWT para autenticação

## Como rodar

```bash
npm install
cp .env.example .env   # preencha as variáveis
npm run dev            # porta 3001
```

## Configurar .env

```
DATABASE_URL=postgresql://postgres:[SUA-SENHA]@db.xxx.supabase.co:5432/postgres
JWT_SECRET=segredo-forte-32-chars-minimo
JWT_EXPIRES_IN=15m
PORT=3001
NODE_ENV=development
```

## O que foi feito

- Migrations 012, 013, 014 rodadas em produção (Supabase)
  - `oauth_credentials` — credenciais TikTok por tenant
  - `live_snapshots` — visualizações em tempo real por cabine
  - `live_products` — produtos vendidos por live
- `src/services/tiktok.js` — agendador node-cron injetando dados mock nas cabines ativas
- `GET /v1/home/dashboard` — dashboard do franqueado (faturamento líquido, GMV TikTok, alertas contratuais)
- `GET /v1/cliente/dashboard` — dashboard do parceiro (lucro projetado, status ao vivo, Top 5 produtos)

## Segurança

Todas as tabelas usam RLS (Row Level Security) no Supabase — cada tenant só acessa seus próprios dados via `tenant_id`.

## Próximos passos

1. **Autenticação real** — endpoint `POST /v1/auth/login` retornando JWT
2. **Integração TikTok real** — substituir mock do agendador pela API oficial do TikTok Shop
3. **Endpoint de Cabines** — `GET /v1/cabines` listando status ao vivo em tempo real
4. **Webhook TikTok** — receber eventos de venda em tempo real
5. **Dashboard do Parceiro** — expandir métricas de comissão e histórico

## Rotas disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | /v1/home/dashboard | Dashboard do franqueado |
| GET | /v1/cliente/dashboard | Dashboard do parceiro |
