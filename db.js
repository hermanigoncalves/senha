const fs = require('fs');
const path = require('path');

const ARQUIVO_DB = path.join(__dirname, 'pacientes.json');

// Cache em memória para fallbacks em ambiente serverless/read-only
let pacientesMemoriaCache = null;

function carregarPacientesDoArquivo() {
 if (pacientesMemoriaCache !== null) {
  return pacientesMemoriaCache;
 }
 try {
  if (fs.existsSync(ARQUIVO_DB)) {
   const conteudo = fs.readFileSync(ARQUIVO_DB, 'utf8');
   pacientesMemoriaCache = JSON.parse(conteudo);
   return pacientesMemoriaCache;
  }
 } catch (e) {
  console.error('Aviso ao ler pacientes.json:', e.message);
 }
 pacientesMemoriaCache = [];
 return pacientesMemoriaCache;
}

function salvarPacientesNoArquivo(pacientes) {
 pacientesMemoriaCache = pacientes;
 try {
  fs.writeFileSync(ARQUIVO_DB, JSON.stringify(pacientes, null, 2), 'utf8');
 } catch (e) {
  console.warn('Aviso: Não foi possível gravar pacientes.json em sistema de arquivos read-only/serverless:', e.message);
 }
}

// Apaga registros de dias anteriores automaticamente (limpeza diária)
async function limparPacientesAntigos() {
 const hojeDataStr = new Date().toISOString().substring(0, 10);

 if (dbConectado && pool) {
  try {
   await pool.query("DELETE FROM pacientes WHERE DATE(criado_em) < CURRENT_DATE");
  } catch (err) {
   console.error('Aviso ao limpar banco PostgreSQL de dias anteriores:', err.message);
  }
 }

 const lista = carregarPacientesDoArquivo();
 const listaFiltradaHoje = lista.filter(p => {
  if (!p.criado_em) return true;
  return p.criado_em.substring(0, 10) === hojeDataStr;
 });

 if (listaFiltradaHoje.length !== lista.length) {
  salvarPacientesNoArquivo(listaFiltradaHoje);
 }
}

// Apaga todos os registros do banco de dados (reinício de fila)
async function limparTodoOBanco() {
 if (dbConectado && pool) {
  try {
   await pool.query("TRUNCATE TABLE pacientes RESTART IDENTITY");
  } catch (err) {
   console.error('Aviso ao truncar tabela de pacientes:', err.message);
  }
 }
 salvarPacientesNoArquivo([]);
}

let Pool = null;
let pool = null;
let dbConectado = false;

try {
 Pool = require('pg').Pool;
 
 const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

 if (connectionString) {
  pool = new Pool({
   connectionString,
   ssl: { rejectUnauthorized: false },
   connectionTimeoutMillis: 5000
  });
 } else {
  pool = new Pool({
   user: process.env.PGUSER || 'postgres',
   host: process.env.PGHOST || 'localhost',
   database: process.env.PGDATABASE || 'cmip',
   password: process.env.PGPASSWORD || 'postgres',
   port: process.env.PGPORT || 5432,
   connectionTimeoutMillis: 2500
  });
 }
} catch (e) {
 console.warn('Aviso ao inicializar módulo pg:', e.message);
}

async function inicializarBanco() {
 if (!pool) {
  dbConectado = false;
  console.log('📁 Modo de Armazenamento Local/Em Memória ATIVO!');
  limparPacientesAntigos();
  return;
 }
 try {
  const client = await pool.connect();
  await client.query(`
   CREATE TABLE IF NOT EXISTS pacientes (
    id SERIAL PRIMARY KEY,
    senha VARCHAR(20) NOT NULL,
    nome VARCHAR(150) NOT NULL,
    tipo VARCHAR(10) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'AGUARDANDO',
    guiche VARCHAR(10),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    chamado_em TIMESTAMP
   );
  `);
  client.release();
  dbConectado = true;
  console.log('✅ Banco PostgreSQL conectado com sucesso!');
  await limparPacientesAntigos();
 } catch (err) {
  dbConectado = false;
  console.log('📁 Banco PostgreSQL indisponível (' + err.message + '). Modo de Armazenamento Local/Em Memória ATIVO!');
  limparPacientesAntigos();
 }
}

inicializarBanco();

module.exports = {
 pool,
 isConectado: () => dbConectado,
 carregarPacientesDoArquivo,
 salvarPacientesNoArquivo,
 limparPacientesAntigos,
 limparTodoOBanco,
 inicializarBanco
};
