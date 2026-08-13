# 🚀 Guia de Implantação do CMIP Servidor na Vercel

Este guia descreve o passo a passo completo para hospedar o sistema **CMIP Servidor** gratuitamente na plataforma **Vercel** com banco de dados **PostgreSQL** na nuvem.

---

## 🛠️ O que foi preparado no projeto?

1. **Handler Serverless (`api/index.js`)**: Adapta o servidor Express para rodar como Serverless Functions na Vercel.
2. **Configuração de Rotas (`vercel.json`)**: Gerencia o roteamento de arquivos estáticos (`public/`) e da API (`/api/*`).
3. **REST Polling Fallback Inteligente**: As telas (`/tv`, `/medico`, `/recepcao`, `/`) alternam automaticamente para HTTP Polling a cada 2 segundos quando rodando na Vercel (onde WebSockets não são suportados). A chamada sonora ding-dong e o sintetizador de voz (TTS em PT-BR) continuam funcionando normalmente no navegador da TV!
4. **Suporte a Cloud PostgreSQL**: O módulo `db.js` detecta a variável `DATABASE_URL` com conexões seguras SSL.

---

## 📋 Passo 1: Criar um Banco de Dados PostgreSQL Gratuito (Neon.tech ou Supabase)

Como o sistema de arquivos da Vercel é efêmero (read-only), recomendamos criar um banco de dados PostgreSQL gratuito:

### Opção A: Neon.tech (Recomendado - 1 clique)
1. Acesse [Neon.tech](https://neon.tech) e faça login gratuito com sua conta GitHub ou Google.
2. Clique em **Create Project** e dê um nome (ex: `cmip-db`).
3. Ao criar o projeto, copie a **Connection String** exibida na tela (exemplo: `postgres://usuario:senha@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require`).

### Opção B: Supabase
1. Acesse [Supabase.com](https://supabase.com) e crie um novo projeto gratuito.
2. Nas configurações do projeto (**Project Settings > Database**), copie a **URI de conexão** (ex: `postgres://postgres:suasenha@db.xyz.supabase.co:5432/postgres`).

---

## 📦 Passo 2: Publicar o Projeto na Vercel

### Método 1: Conectando com GitHub (Mais Fácil)
1. Suba o projeto para um repositório no seu **GitHub** (Público ou Privado).
2. Acesse o painel da [Vercel](https://vercel.com) e clique em **Add New > Project**.
3. Selecione o repositório `cmipservidor` do GitHub.
4. Na tela de configuração:
   - **Framework Preset**: Deixe como *Other*.
   - **Environment Variables**: Adicione a variável:
     - **Name**: `DATABASE_URL`
     - **Value**: (Cole a string de conexão do Neon ou Supabase que você copiou no Passo 1).
5. Clique em **Deploy**.

### Método 2: Usando Vercel CLI (Via Terminal)
1. Instale a Vercel CLI (se ainda não tiver):
   ```bash
   npm install -g vercel
   ```
2. No terminal, dentro da pasta do projeto, execute:
   ```bash
   vercel
   ```
3. Responda às perguntas confirmando as opções padrão.
4. Para adicionar a variável de ambiente do banco de dados:
   ```bash
   vercel env add DATABASE_URL
   ```
   (Cole a URL de conexão do PostgreSQL quando solicitado).
5. Faça o deploy em produção com:
   ```bash
   vercel --prod
   ```

---

## 🌐 URLs de Acesso Após o Deploy

Após o deploy, a Vercel fornecerá um link do projeto (ex: `https://cmipservidor.vercel.app`).
As telas do sistema estarão disponíveis nos seguintes endereços:

- 📺 **Painel da TV (com áudio e chamada):** `https://seu-projeto.vercel.app/tv`
- 🩺 **Painel do Médico:** `https://seu-projeto.vercel.app/medico`
- 📋 **Painel da Recepção:** `https://seu-projeto.vercel.app/recepcao`
- 🖥️ **Painel Geral / Todos os Módulos:** `https://seu-projeto.vercel.app/`

---

## 💡 Dicas de Uso da TV na Vercel

- **Áudio no Navegador**: Ao abrir a tela da TV (`/tv`), dê um clique em qualquer lugar da tela para que o navegador (Chrome/Edge/Safari/Firefox) permita o salvamento do estado do AudioContext e toque o bipe e a voz automaticamente a cada paciente chamado!
