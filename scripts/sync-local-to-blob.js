#!/usr/bin/env node

/**
 * Script para sincronizar dados locais (pasta data/) com Vercel Blob Storage
 * Uso: npm run sync-local-to-blob
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { put } from '@vercel/blob';
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

    if (!fs.existsSync(fullLocalPath)) {
      console.log(`⚠️ Arquivo local não encontrado: ${localPath}`);
      return false;
    }

    const data = fs.readFileSync(fullLocalPath, 'utf8');
    const jsonData = JSON.parse(data);

    // Upload para Blob Storage
    const blob = await put(blobKey, JSON.stringify(jsonData, null, 2), {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true
    });

    console.log(`✅ ${localPath} → ${blobKey}`);
    return true;

  } catch (error) {
    console.error(`❌ Erro ao sincronizar ${localPath}:`, error.message);
    return false;
  }
}

async function main() {
  console.log('🔄 Sincronizando dados locais para Vercel Blob Storage...\n');

  if (!fs.existsSync(DATA_DIR)) {
    console.error(`❌ Diretório data não encontrado: ${DATA_DIR}`);
    process.exit(1);
  }

  let successCount = 0;
  let totalCount = FILES_TO_SYNC.length;

  for (const file of FILES_TO_SYNC) {
    const success = await syncFile(file.local, file.blob);
    if (success) successCount++;
  }

  console.log(`\n📊 Resultado: ${successCount}/${totalCount} arquivos sincronizados`);

  if (successCount === totalCount) {
    console.log('🎉 Sincronização concluída com sucesso!');
  } else {
    console.log('⚠️ Alguns arquivos não puderam ser sincronizados');
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});