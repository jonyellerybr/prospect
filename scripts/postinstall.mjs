import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

async function syncLocalDataToBlob() {
  try {
    console.log("🔄 Sincronizando dados locais para Vercel Blob Storage...");

    // Caminhos dos arquivos locais
    const dataDir = join(projectRoot, "data");
    const companiesFile = join(dataDir, "companies.json");
    const statsFile = join(dataDir, "stats.json");
    const learningFile = join(dataDir, "learning.json");
    const cacheFile = join(dataDir, "cache.json");

    // Verificar se os arquivos existem
    if (!existsSync(dataDir)) {
      console.log("⚠️  Pasta data não encontrada, pulando sincronização");
      return;
    }

    // Ler dados locais
    const companies = existsSync(companiesFile) ? JSON.parse(readFileSync(companiesFile, 'utf8')) : {};
    const stats = existsSync(statsFile) ? JSON.parse(readFileSync(statsFile, 'utf8')) : {};
    const learning = existsSync(learningFile) ? JSON.parse(readFileSync(learningFile, 'utf8')) : {};
    const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};

    console.log(`📊 Dados locais encontrados:`);
    console.log(`   - Empresas: ${Object.keys(companies).length}`);
    console.log(`   - Estatísticas: ${stats.totalSearches || 0} buscas`);
    console.log(`   - Cache: ${Object.keys(cache.searchResults || {}).length} resultados`);

    // Verificar se há dados significativos para sincronizar
    const hasData = Object.keys(companies).length > 0 || (stats.totalSearches || 0) > 0;
    if (!hasData) {
      console.log("⚠️  Nenhum dado significativo encontrado, pulando sincronização");
      return;
    }

    // Preparar dados para sincronização
    const localData = {
      companies: Object.values(companies), // Converter objeto para array
      stats: stats,
      learning: learning,
      cache: cache
    };

    // Fazer requisição para a API de sync (usando fetch nativo do Node)
    const { default: fetch } = await import('node-fetch');

    const response = await fetch('https://prospect.vercel.app/api/sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Vercel-Build-Sync/1.0'
      },
      body: JSON.stringify({
        action: 'sync_to_cloud',
        data: localData
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();

    if (result.success) {
      console.log(`✅ Sincronização concluída: ${result.syncedCount} itens enviados para a nuvem`);
    } else {
      console.error('❌ Erro na sincronização:', result.error);
    }

  } catch (error) {
    console.error('❌ Erro ao sincronizar dados:', error.message);
    console.log('⚠️  Sincronização falhou, mas build continuará');
  }
}

async function main() {
  try {
    console.log("📦 Starting postinstall script...");

    // Primeiro, sincronizar dados locais para a nuvem (se houver dados)
    await syncLocalDataToBlob();

    // Resolve chromium package location
    const chromiumResolvedPath = import.meta.resolve("@sparticuz/chromium");

    // Convert file:// URL to regular path
    const chromiumPath = chromiumResolvedPath.replace(/^file:\/\//, "");

    // Get the package root directory (goes up from build/esm/index.js to package root)
    const chromiumDir = dirname(dirname(dirname(chromiumPath)));
    const binDir = join(chromiumDir, "bin");

    if (!existsSync(binDir)) {
      console.log(
        "⚠️  Chromium bin directory not found, skipping archive creation"
      );
      return;
    }

    // Create tar archive in public folder
    const publicDir = join(projectRoot, "public");
    const outputPath = join(publicDir, "chromium-pack.tar");

    console.log("📦 Creating chromium tar archive...");
    console.log("   Source:", binDir);
    console.log("   Output:", outputPath);

    // Tar the contents of bin/ directly (without bin prefix)
    execSync(`tar -cf "${outputPath}" -C "${binDir}" .`, {
      stdio: "inherit",
      cwd: projectRoot,
    });

    console.log("✅ Chromium archive created successfully!");
  } catch (error) {
    console.error("❌ Failed to create chromium archive:", error.message);
    console.log("⚠️  This is not critical for local development");
    process.exit(0); // Don't fail the install
  }
}

main();