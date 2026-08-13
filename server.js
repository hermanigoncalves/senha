const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const https = require('https');
const { exec } = require('child_process');
const db = require('./db');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));


// Função para reproduzir voz nativa no hardware da máquina local (PC/Mini-PC conectado à TV)
function tocarAudioHardwareServidor(texto) {
 if (process.platform === 'win32') {
  const textoLimpo = texto.replace(/'/g, '').replace(/"/g, '').replace(/`/g, '');
  // Executa bipe duplo (ding-dong: Mi 659Hz + Dó 523Hz) e depois a fala em Português no hardware da máquina
  const psCommand = `powershell -Command "[Console]::Beep(659, 250); [Console]::Beep(523, 500); Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Rate = 0; $synth.Speak('${textoLimpo}')"`;
  exec(psCommand, (err) => {
   if (err) console.warn('Aviso: Falha ao emitir voz no hardware local:', err.message);
  });
 }
}

// Obter fila de pacientes ativa
async function obterFilaAtiva() {
 await db.limparPacientesAntigos();
 if (db.isConectado()) {
  try {
   const res = await db.pool.query(
    "SELECT id, senha, nome, tipo, status, guiche, chamado_em FROM pacientes WHERE status != 'FINALIZADO' ORDER BY id ASC"
   );
   return res.rows.map(r => ({
    id: r.id,
    senha: r.senha,
    nome: r.nome,
    tipo: r.tipo,
    chamado: r.status === 'CHAMADO',
    guiche: r.guiche,
    chamado_em: r.chamado_em ? new Date(r.chamado_em).getTime() : null
   }));
  } catch (err) {
   console.error('Erro ao consultar PostgreSQL:', err);
  }
 }
 
 const listaArquivo = db.carregarPacientesDoArquivo();
 return listaArquivo.filter(r => r.status !== 'FINALIZADO').map(r => ({
  id: r.id,
  senha: r.senha,
  nome: r.nome,
  tipo: r.tipo,
  chamado: r.status === 'CHAMADO',
  guiche: r.guiche,
  chamado_em: r.chamado_em ? new Date(r.chamado_em).getTime() : null
 }));
}

let ultimaChamadaServidor = null;

// Rota de proxy para síntese de voz (TTS) em Português sem problemas de CORS
app.get('/api/tts', (req, res) => {
 const texto = req.query.texto || 'Atenção';
 const encodedText = encodeURIComponent(texto);
 const primaryUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=pt-BR&client=tw-ob`;
 const fallbackUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=pt&client=gtx`;

 function buscarAudio(ttsUrl, tentarFallback = true) {
  const reqOptions = {
   headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Referer': 'https://translate.google.com/'
   },
   timeout: 3500
  };

  const reqApi = https.get(ttsUrl, reqOptions, (apiRes) => {
   if (apiRes.statusCode === 200) {
    res.set({
     'Content-Type': 'audio/mpeg',
     'Cache-Control': 'public, max-age=86400',
     'Access-Control-Allow-Origin': '*'
    });
    return apiRes.pipe(res);
   } else if (apiRes.statusCode >= 300 && apiRes.statusCode < 400 && apiRes.headers.location) {
    return buscarAudio(apiRes.headers.location, false);
   } else {
    if (tentarFallback) {
     return buscarAudio(fallbackUrl, false);
    }
    if (!res.headersSent) res.status(apiRes.statusCode || 500).end();
   }
  });

  reqApi.on('error', (err) => {
   if (tentarFallback) {
    return buscarAudio(fallbackUrl, false);
   }
   console.warn('Aviso: Serviço TTS externo indisponível:', err.message);
   if (!res.headersSent) res.status(500).end();
  });

  reqApi.on('timeout', () => {
   reqApi.destroy();
   if (tentarFallback) {
    return buscarAudio(fallbackUrl, false);
   }
   if (!res.headersSent) res.status(504).end();
  });
 }

 buscarAudio(primaryUrl, true);
});

// REST API Endpoints

// 1. Obter Pacientes
app.get('/api/pacientes', async (req, res) => {
 res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
 const fila = await obterFilaAtiva();
 res.json(fila);
});

// 2. Gerar Senha (Endpoint REST)
app.post('/api/pacientes/gerar', async (req, res) => {
 const { senha, nome, tipo } = req.body;
 if (!nome || !senha) return res.status(400).json({ error: 'Nome e senha são obrigatórios' });

 if (db.isConectado()) {
  try {
   await db.pool.query(
    "INSERT INTO pacientes (senha, nome, tipo, status) VALUES ($1, $2, $3, 'AGUARDANDO')",
    [senha, nome, tipo || 'A']
   );
  } catch(e) {
   console.error('Erro ao inserir no Postgres:', e);
  }
 } else {
  const lista = db.carregarPacientesDoArquivo();
  lista.push({
   id: Date.now(),
   senha,
   nome,
   tipo: tipo || 'A',
   status: 'AGUARDANDO',
   guiche: null,
   criado_em: new Date().toISOString()
  });
  db.salvarPacientesNoArquivo(lista);
 }

 const filaAtualizada = await obterFilaAtiva();
 io.emit('filaAtualizada', filaAtualizada);
 res.json({ success: true, senha, nome });
});

// 3. Chamar Paciente (Endpoint REST de Disparo Automático)
app.post('/api/pacientes/chamar', async (req, res) => {
 const { index, guiche, id } = req.body;
 const fila = await obterFilaAtiva();
 let paciente = null;

 if (db.isConectado()) {
  if (id) {
   await db.pool.query(
    "UPDATE pacientes SET status = 'CHAMADO', guiche = $1, chamado_em = CURRENT_TIMESTAMP WHERE id = $2",
    [guiche || '1', id]
   );
   paciente = fila.find(p => p.id === id);
  } else if (typeof index !== 'undefined' && fila[index]) {
   paciente = fila[index];
   if (paciente.id) {
    await db.pool.query(
     "UPDATE pacientes SET status = 'CHAMADO', guiche = $1, chamado_em = CURRENT_TIMESTAMP WHERE id = $2",
     [guiche || '1', paciente.id]
    );
   }
  }
 } else {
  const lista = db.carregarPacientesDoArquivo();
  const alvo = (id ? lista.find(p => p.id === id) : null) || (typeof index !== 'undefined' ? lista.filter(p => p.status !== 'FINALIZADO')[index] : null);
  if (alvo) {
   alvo.status = 'CHAMADO';
   alvo.guiche = guiche || '1';
   alvo.chamado_em = new Date().toISOString();
   db.salvarPacientesNoArquivo(lista);
   paciente = { id: alvo.id, senha: alvo.senha, nome: alvo.nome, tipo: alvo.tipo, chamado: true, guiche: alvo.guiche, chamado_em: alvo.chamado_em };
  }
 }

 if (paciente) {
  const dadosChamada = { ...paciente, guiche: guiche || '1', timestamp: Date.now() };
  ultimaChamadaServidor = dadosChamada;
  
  io.emit('novaChamada', dadosChamada);
  
  const filaAtualizada = await obterFilaAtiva();
  io.emit('filaAtualizada', filaAtualizada);

  const textoFala = `Atenção. Senha ${dadosChamada.senha}. Paciente ${dadosChamada.nome}. Dirigir-se ao guichê ${dadosChamada.guiche}`;
  tocarAudioHardwareServidor(textoFala);

  return res.json({ success: true, chamada: dadosChamada });
 }

 res.status(404).json({ error: 'Paciente não encontrado' });
});

// 3.5. Obter Última Chamada (Endpoint REST para TV / Polling Vercel)
app.get('/api/pacientes/ultima-chamada', async (req, res) => {
 res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
 if (ultimaChamadaServidor) {
  return res.json(ultimaChamadaServidor);
 }
 const fila = await obterFilaAtiva();
 const chamados = fila.filter(p => p.chamado === true);
 if (chamados.length > 0) {
  chamados.sort((a, b) => (b.chamado_em || b.id || 0) - (a.chamado_em || a.id || 0));
  return res.json(chamados[0]);
 }
 res.json(null);
});

// 4. Finalizar Paciente (Endpoint REST)
app.post('/api/pacientes/finalizar', async (req, res) => {
 const { index, id } = req.body;
 const fila = await obterFilaAtiva();
 let paciente = null;

 if (db.isConectado()) {
  if (id) {
   await db.pool.query(
    "UPDATE pacientes SET status = 'FINALIZADO' WHERE id = $1",
    [id]
   );
   paciente = true;
  } else if (typeof index !== 'undefined' && fila[index]) {
   paciente = fila[index];
   if (paciente.id) {
    await db.pool.query(
     "UPDATE pacientes SET status = 'FINALIZADO' WHERE id = $1",
     [paciente.id]
    );
   }
  }
 } else {
  const lista = db.carregarPacientesDoArquivo();
  const alvo = (id ? lista.find(p => p.id === id) : null) || (typeof index !== 'undefined' ? lista.filter(p => p.status !== 'FINALIZADO')[index] : null);
  if (alvo) {
   alvo.status = 'FINALIZADO';
   db.salvarPacientesNoArquivo(lista);
   paciente = true;
  }
 }

 if (paciente) {
  const filaAtualizada = await obterFilaAtiva();
  io.emit('filaAtualizada', filaAtualizada);
  return res.json({ success: true });
 }

 res.status(404).json({ error: 'Paciente não encontrado' });
});

// 5. Limpar Banco de Dados (Endpoint REST)
app.post('/api/pacientes/limpar', async (req, res) => {
 ultimaChamadaServidor = null;
 await db.limparTodoOBanco();
 const filaAtualizada = await obterFilaAtiva();
 io.emit('filaAtualizada', filaAtualizada);
 res.json({ success: true, message: 'Banco de dados limpo com sucesso' });
});

app.delete('/api/pacientes', async (req, res) => {
 ultimaChamadaServidor = null;
 await db.limparTodoOBanco();
 const filaAtualizada = await obterFilaAtiva();
 io.emit('filaAtualizada', filaAtualizada);
 res.json({ success: true, message: 'Banco de dados limpo com sucesso' });
});

// WebSocket Event Handling
io.on('connection', async (socket) => {
 const filaInicial = await obterFilaAtiva();
 socket.emit('filaAtualizada', filaInicial);

 socket.on('gerarSenha', async (dados) => {
  if (db.isConectado()) {
   try {
    await db.pool.query(
     "INSERT INTO pacientes (senha, nome, tipo, status) VALUES ($1, $2, $3, 'AGUARDANDO')",
     [dados.senha, dados.nome, dados.tipo || 'A']
    );
   } catch(e) {}
  } else {
   const lista = db.carregarPacientesDoArquivo();
   lista.push({
    id: Date.now(),
    senha: dados.senha,
    nome: dados.nome,
    tipo: dados.tipo || 'A',
    status: 'AGUARDANDO',
    guiche: null,
    criado_em: new Date().toISOString()
   });
   db.salvarPacientesNoArquivo(lista);
  }

  const filaAtualizada = await obterFilaAtiva();
  io.emit('filaAtualizada', filaAtualizada);
 });

 socket.on('chamarPaciente', async (dados) => {
  const fila = await obterFilaAtiva();
  const paciente = fila[dados.index];

  if (paciente) {
   paciente.chamado = true;
   paciente.guiche = dados.guiche;

   if (db.isConectado() && paciente.id) {
    try {
     await db.pool.query(
      "UPDATE pacientes SET status = 'CHAMADO', guiche = $1, chamado_em = CURRENT_TIMESTAMP WHERE id = $2",
      [dados.guiche, paciente.id]
     );
    } catch(e) {}
   } else {
    const lista = db.carregarPacientesDoArquivo();
    const alvo = lista.find(p => p.id === paciente.id || (p.senha === paciente.senha && p.nome === paciente.nome));
    if (alvo) {
     alvo.status = 'CHAMADO';
     alvo.guiche = dados.guiche;
     alvo.chamado_em = new Date().toISOString();
     db.salvarPacientesNoArquivo(lista);
    }
   }

    const dadosChamada = { ...paciente, guiche: dados.guiche, timestamp: Date.now() };
    ultimaChamadaServidor = dadosChamada;
    io.emit('novaChamada', dadosChamada);

   const filaAtualizada = await obterFilaAtiva();
   io.emit('filaAtualizada', filaAtualizada);

   const textoFala = `Atenção. Senha ${dadosChamada.senha}. Paciente ${dadosChamada.nome}. Dirigir-se ao guichê ${dadosChamada.guiche}`;
   tocarAudioHardwareServidor(textoFala);
  }
 });

 socket.on('finalizarPaciente', async (index) => {
  const fila = await obterFilaAtiva();
  const paciente = fila[index];

  if (paciente) {
   if (db.isConectado() && paciente.id) {
    try {
     await db.pool.query(
      "UPDATE pacientes SET status = 'FINALIZADO' WHERE id = $1",
      [paciente.id]
     );
    } catch(e) {}
   } else {
    const lista = db.carregarPacientesDoArquivo();
    const alvo = lista.find(p => p.id === paciente.id || (p.senha === paciente.senha && p.nome === paciente.nome));
    if (alvo) {
     alvo.status = 'FINALIZADO';
     db.salvarPacientesNoArquivo(lista);
    }
   }

   const filaAtualizada = await obterFilaAtiva();
   io.emit('filaAtualizada', filaAtualizada);
  }
 });
});

// Rotas de Páginas
app.get('/recepcao', (req, res) => {
 res.sendFile(__dirname + '/public/recepcao.html');
});

app.get('/medico', (req, res) => {
 res.sendFile(__dirname + '/public/medico.html');
});

app.get('/tv', (req, res) => {
 res.sendFile(__dirname + '/public/tv.html');
});

module.exports = app;

if (require.main === module) {
 const PORT = process.env.PORT || 3000;
 http.listen(PORT, '0.0.0.0', () => {
  console.log('====================================================');
  console.log(`🏥 Servidor CMIP rodando com sucesso na porta ${PORT}!`);
  console.log(`-> No mesmo PC:  http://localhost:${PORT}`);
  console.log('====================================================');
 });
}