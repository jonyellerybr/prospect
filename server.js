import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

// Import API routes
import searchHandler from './api/search.js';
import resultsHandler from './api/results.js';
import statsHandler from './api/stats.js';
import analyzeHandler from './api/analyze.js';
import syncHandler from './api/sync.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Flag para controlar sincronização inicial
let initialSyncDone = false;

// Função para sincronizar dados locais durante cold start
async function performInitialSync() {
  if (initialSyncDone) return;

  try {
    console.log('🔄 Verificando sincronização inicial de dados locais...');

    // Caminhos dos arquivos locais
    const dataDir = path.join(__dirname, 'data');
    const syncFile = path.join(dataDir, 'deploy-sync.json');

    // Verificar se há arquivo de sync preparado
    if (!fs.existsSync(syncFile)) {
      console.log('⚠️  Nenhum arquivo de sync encontrado, pulando sincronização inicial');
      initialSyncDone = true;
      return;
    }

    // Ler dados preparados para sync
    const syncData = JSON.parse(fs.readFileSync(syncFile, 'utf8'));

    if (!syncData.needsSync) {
      console.log('⚠️  Sync já foi realizado anteriormente');
      initialSyncDone = true;
      return;
    }

    console.log(`📊 Dados para sincronizar:`);
    console.log(`   - Empresas: ${syncData.companies?.length || 0}`);
    console.log(`   - Estatísticas: ${syncData.stats?.totalSearches || 0} buscas`);

    // Simular requisição para o handler de sync
    const mockReq = {
      method: 'POST',
      body: {
        action: 'sync_to_cloud',
        data: {
          companies: syncData.companies || [],
          stats: syncData.stats || {},
          learning: syncData.learning || {},
          cache: syncData.cache || {}
        }
      }
    };

    const mockRes = {
      status: (code) => ({
        json: (data) => {
          console.log(`📊 Status ${code}:`, data);
          return data;
        }
      })
    };

    // Executar sincronização
    await syncHandler(mockReq, mockRes);

    // Marcar como concluído e remover arquivo
    syncData.needsSync = false;
    fs.writeFileSync(syncFile, JSON.stringify(syncData, null, 2));

    console.log('✅ Sincronização inicial concluída');
    initialSyncDone = true;

  } catch (error) {
    console.error('❌ Erro na sincronização inicial:', error.message);
    initialSyncDone = true; // Evitar tentativas repetidas
  }
}

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para sincronização inicial
app.use(async (req, res, next) => {
  // Executar sync inicial na primeira requisição
  await performInitialSync();
  next();
});

// API Routes
app.post('/api/search', searchHandler);
app.get('/api/results', resultsHandler);
app.get('/api/stats', statsHandler);
app.post('/api/analyze', analyzeHandler);
app.post('/api/sync', syncHandler);

// Serve index.html for all other routes (SPA)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📁 Data directory: ${path.join(__dirname, 'data')}`);
});