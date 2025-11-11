import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = dirname(__dirname);

async function prepareLocalDataForDeploySync() {
  try {
    console.log("🔄 Preparando dados locais para sincronização durante deploy...");

    // Caminhos dos arquivos locais
    const dataDir = join(projectRoot, "data");
    const companiesFile = join(dataDir, "companies.json");
    const statsFile = join(dataDir, "stats.json");
    const learningFile = join(dataDir, "learning.json");
    const cacheFile = join(dataDir, "cache.json");

    // Verificar se os arquivos existem
    if (!existsSync(dataDir)) {
      console.log("⚠️  Pasta data não encontrada, pulando preparação");
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
      console.log("⚠️  Nenhum dado significativo encontrado, pulando preparação");
      return;
    }

    // Criar arquivo de dados preparados para sincronização durante cold start
    const syncData = {
      companies: Object.values(companies), // Converter objeto para array
      stats: stats,
      learning: learning,
      cache: cache,
      timestamp: Date.now(),
      version: '1.0',
      needsSync: true
    };

    // Salvar em arquivo que será usado durante o cold start do Vercel
    const syncFile = join(dataDir, 'deploy-sync.json');
    require('fs').writeFileSync(syncFile, JSON.stringify(syncData, null, 2));

    console.log(`✅ Dados preparados para sincronização durante deploy: ${Object.keys(companies).length} empresas`);
    console.log(`📁 Arquivo criado: ${syncFile}`);

  } catch (error) {
    console.error('❌ Erro ao preparar dados para sincronização:', error.message);
    console.log('⚠️  Preparação falhou, mas build continuará');
  }
}

async function main() {
  try {
    console.log("📦 Starting postinstall script...");

    // Primeiro, preparar dados locais para sincronização durante deploy
    await prepareLocalDataForDeploySync();

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