import { storage } from './storage.js';

// URL to the Chromium binary package hosted in /public, if not in production, use a fallback URL
// alternatively, you can host the chromium-pack.tar file elsewhere and update the URL below
const CHROMIUM_PACK_URL = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}/chromium-pack.tar`
  : "https://raw.githubusercontent.com/gabenunez/puppeteer-on-vercel/refs/heads/main/example/chromium-dont-use-in-prod.tar";

// Cache the Chromium executable path to avoid re-downloading on subsequent requests
let cachedExecutablePath = null;
let downloadPromise = null;

/**
 * Downloads and caches the Chromium executable path.
 * Uses a download promise to prevent concurrent downloads.
 */
async function getChromiumPath() {
  // Return cached path if available
  if (cachedExecutablePath) return cachedExecutablePath;

  // Prevent concurrent downloads by reusing the same promise
  if (!downloadPromise) {
    const chromium = (await import("@sparticuz/chromium-min")).default;
    downloadPromise = chromium
      .executablePath(CHROMIUM_PACK_URL)
      .then((path) => {
        cachedExecutablePath = path;
        console.log("Chromium path resolved:", path);
        return path;
      })
      .catch((error) => {
        console.error("Failed to get Chromium path:", error);
        downloadPromise = null; // Reset on error to allow retry
        throw error;
      });
  }

  return downloadPromise;
}

let browser;
async function getBrowser() {
  if (browser) return browser;

  const isVercel = !!process.env.VERCEL_ENV;
  let puppeteer,
    launchOptions = {
      headless: true,
    };

  if (isVercel) {
    // Vercel: Use puppeteer-core with downloaded Chromium binary
    const chromium = (await import("@sparticuz/chromium-min")).default;
    puppeteer = await import("puppeteer-core");
    const executablePath = await getChromiumPath();
    launchOptions = {
      ...launchOptions,
      args: chromium.args,
      executablePath,
    };
    console.log("Launching browser with executable path:", executablePath);
  } else {
    // Local: Use regular puppeteer with bundled Chromium
    puppeteer = await import("puppeteer");
  }

  browser = await puppeteer.launch(launchOptions);
  return browser;
}

const NEIGHBORHOODS = [
  "Aldeota", "Meireles", "Mucuripe", "Varjota", "Papicu",
  "Centro", "Benfica", "Messejana", "Parangaba"
];

const BUSINESS_TYPES = [
  "restaurante", "advogado", "dentista", "salão beleza",
  "academia", "pet shop", "mecânica", "loja roupas"
];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { searchIndex = 0, maxSearches = 5 } = req.body;

    // Gerar termo de busca
    const neighborhood = NEIGHBORHOODS[searchIndex % NEIGHBORHOODS.length];
    const business = BUSINESS_TYPES[Math.floor(searchIndex / NEIGHBORHOODS.length) % BUSINESS_TYPES.length];
    const searchTerm = `${business} ${neighborhood} fortaleza`;

    console.log(`🔍 Buscando: ${searchTerm}`);

    let results = [];

    // Usar Puppeteer com configuração otimizada para Vercel
    try {
      console.log('🚀 Iniciando browser...');
      browser = await getBrowser();

      const page = await browser.newPage();

      // Configurar headers para simular navegador real
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      });

      // Setar user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Buscar no Google
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10&hl=pt-BR`;
      console.log(`🌐 Acessando: ${searchUrl}`);

      const response = await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      if (!response.ok()) {
        throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
      }

      // Aguardar carregamento dos resultados
      await page.waitForTimeout(3000);

      console.log('📄 Página carregada, extraindo resultados...');

      // Extrair resultados usando JavaScript na página
      results = await page.evaluate(() => {
        const extractedResults = [];

        // Função auxiliar para limpar texto
        const cleanText = (text) => text?.trim().replace(/\s+/g, ' ') || '';

        // Selecionar todos os resultados de busca
        const resultElements = document.querySelectorAll('div.g, div[data-ved], div.yuRUbf');

        for (let i = 0; i < Math.min(resultElements.length, 8); i++) {
          const element = resultElements[i];

          // Extrair link
          const linkElement = element.querySelector('a[href]');
          if (!linkElement) continue;

          const url = linkElement.href;
          if (!url || !url.startsWith('http') ||
              url.includes('google.com') ||
              url.includes('youtube.com') ||
              url.includes('facebook.com') ||
              url.includes('instagram.com') ||
              url.includes('wikipedia.org') ||
              url.includes('linkedin.com')) {
            continue;
          }

          // Extrair título
          let title = '';
          const titleSelectors = ['h3', '.LC20lb', '.DKV0Md'];
          for (const selector of titleSelectors) {
            const titleEl = element.querySelector(selector);
            if (titleEl) {
              title = cleanText(titleEl.textContent);
              if (title) break;
            }
          }

          // Se não encontrou título específico, usar o texto do link
          if (!title) {
            title = cleanText(linkElement.textContent);
          }

          // Extrair descrição
          let description = '';
          const descSelectors = ['.VwiC3b', '.aCOpRe', 'span[data-ved]', '.IsZvec'];
          for (const selector of descSelectors) {
            const descEl = element.querySelector(selector);
            if (descEl) {
              description = cleanText(descEl.textContent);
              if (description) break;
            }
          }

          // Validar resultado
          if (title && title.length > 3 && url) {
            extractedResults.push({
              title: title.substring(0, 100),
              url: url,
              description: description.substring(0, 200),
              position: extractedResults.length + 1
            });
          }

          // Limitar a 6 resultados
          if (extractedResults.length >= 6) break;
        }

        return extractedResults;
      });

      console.log(`📊 Extraídos ${results.length} resultados válidos`);

    } catch (browserError) {
      console.error('❌ Erro no browser:', browserError.message);
      console.log('❌ Nenhum resultado encontrado - Google pode estar bloqueando');
    }

    // Filtrar e validar resultados
    const validResults = results.filter(r =>
      r.url &&
      !r.url.includes('google.com') &&
      !r.url.includes('youtube.com') &&
      !r.url.includes('facebook.com') &&
      (r.description.length > 10 || r.title.length > 5)
    );

    // Salvar no JSON storage
    if (validResults.length > 0) {
      const timestamp = Date.now();

      for (const result of validResults) {
        const key = `company:${Buffer.from(result.url).toString('base64').substring(0, 50)}`;

        await storage.saveCompany(key, {
          ...result,
          searchTerm,
          neighborhood,
          businessType: business,
          foundAt: timestamp
        });
      }

      // Atualizar estatísticas
      await storage.incrementStat('totalSearches', 1);
      await storage.incrementStat('totalResults', validResults.length);
      await storage.incrementNeighborhoodHits(neighborhood, validResults.length);
      await storage.incrementBusinessHits(business, validResults.length);
    }

    return res.status(200).json({
      success: true,
      searchTerm,
      neighborhood,
      businessType: business,
      resultsFound: validResults.length,
      results: validResults,
      nextSearchIndex: searchIndex + 1,
      hasMore: searchIndex + 1 < maxSearches
    });

  } catch (error) {
    console.error('❌ Erro na busca:', error);
    
    return res.status(500).json({
      success: false,
      error: error.message,
      searchIndex: req.body.searchIndex
    });
  }
}