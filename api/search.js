import { storage } from './storage.js';
import { updateLearning } from './ai.js';

// URL to the Chromium binary package hosted in /public, if not in production, use a fallback URL
// alternatively, you can host the chromium-pack.tar file elsewhere and update the URL below
const CHROMIUM_PACK_URL = "https://github.com/Sparticuz/chromium/releases/download/v126.0.0/chromium-v126.0.0-pack.tar";

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
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-default-apps',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      executablePath,
    };
    console.log("Launching browser with executable path:", executablePath);
  } else {
    // Local: Use regular puppeteer with bundled Chromium
    puppeteer = await import("puppeteer");
    launchOptions.args = [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
      '--disable-web-security',
      '--disable-features=VizDisplayCompositor'
    ];
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

      // Configurar headers para simular navegador real (baseado no agent-prospect.js)
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      });

      // Setar user agent
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

      // Configurar viewport
      await page.setViewport({ width: 1366, height: 768 });

      // Adicionar cookies para simular sessão real
      await page.setCookie({
        name: 'CONSENT',
        value: 'YES+BR.pt+20150628-20-0',
        domain: '.google.com'
      });

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

      // Aguardar carregamento dos resultados com verificação de seletor
      await page.waitForSelector('div.g, div[data-ved], div.yuRUbf', { timeout: 15000 });
      await new Promise(resolve => setTimeout(resolve, 3000));

      console.log('📄 Página carregada, extraindo resultados...');

      // Extrair resultados usando JavaScript na página
      results = await page.evaluate(() => {
        const extractedResults = [];

        // Função auxiliar para limpar texto
        const cleanText = (text) => text?.trim().replace(/\s+/g, ' ') || '';

        // Estratégia mais robusta para extrair resultados do Google
        const allLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
          const href = a.href;
          return href &&
                 href.startsWith('http') &&
                 !href.includes('google.com') &&
                 !href.includes('youtube.com') &&
                 !href.includes('wikipedia.org') &&
                 !href.includes('facebook.com') &&
                 !href.includes('instagram.com') &&
                 !href.includes('linkedin.com') &&
                 !href.includes('googleusercontent.com') &&
                 !href.includes('translate.google.com') &&
                 !href.includes('maps.google.com') &&
                 !href.includes('books.google.com') &&
                 !href.includes('news.google.com');
        });

        console.log(`🔍 Encontrados ${allLinks.length} links válidos na página...`);

        for (let i = 0; i < Math.min(allLinks.length, 8); i++) {
          const link = allLinks[i];
          const title = link.textContent?.trim() || link.querySelector('h3')?.textContent?.trim() || '';

          // Tentar encontrar o título no elemento pai se não estiver no link
          let finalTitle = title;
          if (!finalTitle) {
            const parent = link.closest('div.g') || link.closest('div[data-ved]');
            if (parent) {
              const h3 = parent.querySelector('h3');
              if (h3) finalTitle = h3.textContent?.trim();
            }
          }

          if (finalTitle && finalTitle.length > 3) { // Título deve ter pelo menos 4 caracteres
            console.log(`Resultado ${i + 1}:`);
            console.log(`  Título: ${finalTitle.substring(0, 50)}`);
            console.log(`  URL: ${link.href.substring(0, 50)}`);

            // Extrair descrição do snippet do Google
            let description = '';
            const parent = link.closest('div.g') || link.closest('div[data-ved]');
            if (parent) {
              const snippet = parent.querySelector('span[data-ved]') || parent.querySelector('.VwiC3b') || parent.querySelector('span');
              if (snippet) {
                description = snippet.textContent?.trim() || '';
              }
            }

            extractedResults.push({
              title: finalTitle.substring(0, 100),
              url: link.href,
              description: description.substring(0, 200),
              position: extractedResults.length + 1
            });
            console.log(`  ✅ Adicionado à lista`);

            if (extractedResults.length >= 6) break;
          } else {
            console.log(`Resultado ${i + 1} rejeitado: título muito curto ou vazio`);
          }
        }

        console.log(`📊 Total de resultados válidos extraídos: ${extractedResults.length}`);
        return extractedResults;
      });

      // Usar IA para validar se os links são realmente de empresas (apenas individuais, não listas/diretórios)
      const validatedResults = [];
      for (const result of results) {
        try {
          console.log(`🤖 Validando empresa: ${result.title}`);

          // Primeiro filtro rápido baseado na URL e título
          const urlLower = result.url.toLowerCase();
          const titleLower = result.title.toLowerCase();

          // Rejeitar imediatamente listas, diretórios, notícias, etc.
          const rejectPatterns = [
            /lista.*empresa/i, /diretório/i, /notícia/i, /news/i,
            /facebook\.com/i, /instagram\.com/i, /youtube\.com/i,
            /mercadolivre/i, /olx/i, /wikipedia/i, /google/i,
            /translate\.google/i, /maps\.google/i, /books\.google/i,
            /news\.google/i, /linkedin/i, /twitter/i, /tiktok/i,
            /tripadvisor/i, /yelp/i, /ifood/i, /uber eats/i
          ];

          const shouldReject = rejectPatterns.some(pattern =>
            pattern.test(urlLower) || pattern.test(titleLower) || pattern.test(result.description)
          );

          if (shouldReject) {
            console.log(`❌ ${result.title} - Rejeitado: lista/diretório/notícia/redes sociais`);
            continue;
          }

          // Criar um novo browser para validação (mais seguro)
          const puppeteer = isVercel ?
            await import("puppeteer-core") :
            await import("puppeteer");

          const validationBrowser = await puppeteer.launch(launchOptions);
          const validationPage = await validationBrowser.newPage();

          // Configurar headers para validação
          await validationPage.setExtraHTTPHeaders({
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
          });

          await validationPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

          // Visitar a página e analisar
          await validationPage.goto(result.url, { waitUntil: 'domcontentloaded', timeout: 15000 });
          await new Promise(resolve => setTimeout(resolve, 2000));

          const analysis = await validationPage.evaluate(() => {
            const bodyText = document.body?.textContent?.toLowerCase() || '';
            const url = window.location.href.toLowerCase();
            const title = document.title?.toLowerCase() || '';

            // Verificar se é uma página de empresa individual (não lista/diretório)
            const isListPage = bodyText.includes('lista de') ||
                              bodyText.includes('diretório') ||
                              bodyText.includes('empresas em') ||
                              bodyText.includes('encontre') ||
                              bodyText.includes('buscar') ||
                              /resultado.*busca/i.test(bodyText) ||
                              document.querySelectorAll('a[href*="empresa"], a[href*="business"]').length > 10;

            if (isListPage) {
              return { isCompany: false, reason: 'Página de lista/diretório' };
            }

            const positive = {
              contact: !!(document.querySelector('a[href*="tel:"], a[href*="mailto:"]') ||
                         bodyText.includes('contato') || bodyText.includes('telefone') ||
                         bodyText.includes('fale conosco')),
              services: !!(bodyText.includes('serviço') || bodyText.includes('produto') ||
                          bodyText.includes('oferecemos') || bodyText.includes('trabalhamos')),
              location: !!(bodyText.includes('endereço') || bodyText.includes('localização') ||
                          document.querySelector('iframe[src*="maps"]')),
              whatsapp: !!document.querySelector('a[href*="wa.me"], a[href*="whatsapp"]'),
              pricing: !!(bodyText.includes('preço') || bodyText.includes('orçamento') ||
                         bodyText.includes('cotação')),
              businessHours: !!(bodyText.includes('horário') || bodyText.includes('funcionamento')),
              about: !!(bodyText.includes('sobre nós') || bodyText.includes('empresa') ||
                       bodyText.includes('história'))
            };

            const negative = {
              news: !!(bodyText.includes('notícia') || url.includes('/noticia/') ||
                      title.includes('notícia')),
              directory: !!(bodyText.includes('diretório') || bodyText.includes('lista de empresas')),
              social: !!(url.includes('facebook.com') || url.includes('instagram.com')),
              marketplace: !!(url.includes('mercadolivre') || url.includes('olx.com')),
              search: !!(bodyText.includes('resultados da busca') || bodyText.includes('não encontrou'))
            };

            const positiveScore = Object.values(positive).filter(Boolean).length;
            const negativeScore = Object.values(negative).filter(Boolean).length;
            const score = positiveScore - (negativeScore * 2);

            return {
              isCompany: score >= 2 && !Object.values(negative).some(Boolean),
              score,
              positiveScore,
              negativeScore,
              positive,
              negative,
              bodyPreview: bodyText.substring(0, 1000)
            };
          });

          await validationBrowser.close();

          // Decidir se é empresa baseado na análise
          if (!analysis.isCompany) {
            console.log(`❌ ${result.title} - Descartado: ${analysis.reason || `score ${analysis.score} (positivo: ${analysis.positiveScore}, negativo: ${analysis.negativeScore})`}`);
            continue;
          }

          console.log(`✅ ${result.title} - Empresa confirmada (score: ${analysis.score})`);
          validatedResults.push(result);

          // Pequena pausa entre validações
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (validationError) {
          console.error(`❌ Erro na validação de ${result.title}:`, validationError.message);
          // Em caso de erro de carregamento, não incluir (pode ser página problemática)
          continue;
        }
      }

      console.log(`🎯 Após validação rigorosa: ${validatedResults.length} empresas individuais confirmadas de ${results.length} links iniciais`);
      results = validatedResults;

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

    // Salvar no JSON storage e atualizar aprendizado
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

      // Atualizar sistema de aprendizado
      await updateLearning(searchTerm, neighborhood, business, 'google_search', validResults.length);
    } else {
      // Mesmo sem resultados, atualizar aprendizado para estratégia pouco efetiva
      await updateLearning(searchTerm, neighborhood, business, 'google_search', 0);
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