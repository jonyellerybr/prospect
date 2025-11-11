#!/usr/bin/env node

/**
 * Script para sincronizar dados do Vercel Blob Storage para pasta local (data/)
 * Uso: npm run sync-blob-to-local
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { head } from '@vercel/blob';
import dotenv from 'dotenv';

// Carregar variáveis de ambiente
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configurações
const DATA_DIR = path.join(__dirname, '..', 'data');
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!BLOB_TOKEN) {
  console.error('❌ Erro: BLOB_READ_WRITE_TOKEN não encontrado no .env');
  console.log('Configure a variável de ambiente BLOB_READ_WRITE_TOKEN');
  process.exit(1);
}

// Arquivos a sincronizar
const FILES_TO_SYNC = [
  { local: 'companies.json', blob: 'companies.json' },
  { local: 'stats.json', blob: 'stats.json' },
  { local: 'learning.json', blob: 'learning.json' },
  { local: 'cache.json', blob: 'cache.json' }
];

async function syncFile(localPath, blobKey) {
  try {
    const fullLocalPath = path.join(DATA_DIR, localPath);

    // Tentar baixar do Blob Storage
    const blob = await head(blobKey);

    if (!blob) {
      console.log(`⚠️ Arquivo não encontrado no Blob Storage: ${blobKey}`);
      return false;
    }

    // Fazer fetch do conteúdo
    const response = await fetch(blob.url);
    const data = await response.text();
    const jsonData = JSON.parse(data);

    // Garantir que o diretório existe
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    // Salvar localmente
    fs.writeFileSync(fullLocalPath, JSON.stringify(jsonData, null, 2), 'utf8');

    console.log(`✅ ${blobKey} → ${localPath}`);
    return true;

  } catch (error) {
    console.error(`❌ Erro ao sincronizar ${blobKey}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Sincronizando dados do Vercel Blob Storage para local...\n');

  // Garantir que o diretório data existe
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`📁 Diretório data criado: ${DATA_DIR}`);
  }

  let successCount = 0;
  let totalCount = FILES_TO_SYNC.length;

  for (const file of FILES_TO_SYNC) {
    const success = await syncFile(file.local, file.blob);
    if (success) successCount++;
  }

  console.log(`\n📊 Resultado: ${successCount}/${totalCount} arquivos sincronizados`);

  if (successCount > 0) {
    console.log('🎉 Sincronização concluída!');
  } else {
    console.log('⚠️ Nenhum arquivo foi sincronizado');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});