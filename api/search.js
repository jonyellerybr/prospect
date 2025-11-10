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
     const { searchIndex = 0, maxSearches = 5, parallelSearches = 1 } = req.body;

     // Limitar paralelização para evitar sobrecarga
     const actualParallel = Math.min(parallelSearches, 3);

     if (actualParallel > 1) {
       // Modo paralelizado
       return await performParallelSearches(searchIndex, maxSearches, actualParallel, res);
     }

     // Modo sequencial (padrão)
     const { searchIndex: currentIndex, maxSearches: max } = req.body;

     // Gerar termo de busca
     const neighborhood = NEIGHBORHOODS[currentIndex % NEIGHBORHOODS.length];
     const business = BUSINESS_TYPES[Math.floor(currentIndex / NEIGHBORHOODS.length) % BUSINESS_TYPES.length];
     const searchTerm = `${business} ${neighborhood} fortaleza`;

     // Verificar cache primeiro
     const cachedResult = await storage.getCachedSearchResult(searchTerm);
     if (cachedResult) {
       console.log(`⚡ Resultado em cache encontrado: ${searchTerm}`);

       // Atualizar estatísticas mesmo para resultados em cache
       await storage.incrementStat('totalResults', cachedResult.results.length);
       await storage.incrementNeighborhoodHits(neighborhood, cachedResult.results.length);
       await storage.incrementBusinessHits(business, cachedResult.results.length);

       return res.status(200).json({
         success: true,
         searchTerm,
         neighborhood,
         businessType: business,
         resultsFound: cachedResult.results.length,
         results: cachedResult.results,
         nextSearchIndex: searchIndex + 1,
         hasMore: searchIndex + 1 < maxSearches,
         cached: true,
         message: 'Resultado obtido do cache'
       });
     }

     // Verificar se já existe busca para este termo
     const existingSearchKey = `search:${Buffer.from(searchTerm).toString('base64')}`;
     const existingSearch = await storage.getCompany(existingSearchKey);

     if (existingSearch && existingSearch.completedAt) {
       console.log(`🔄 Busca já realizada anteriormente: ${searchTerm}`);

       // Buscar resultados associados a esta busca usando index otimizado
       const relatedResults = await storage.getCompaniesBySearchTerm(searchTerm);

       // Cachear o resultado para futuras buscas
       await storage.setCachedSearchResult(searchTerm, {
         results: relatedResults,
         timestamp: Date.now()
       });

       // Atualizar estatísticas mesmo para buscas puladas (não incrementar totalSearches)
       await storage.incrementStat('totalResults', relatedResults.length);
       await storage.incrementNeighborhoodHits(neighborhood, relatedResults.length);
       await storage.incrementBusinessHits(business, relatedResults.length);

       return res.status(200).json({
         success: true,
         searchTerm,
         neighborhood,
         businessType: business,
         resultsFound: relatedResults.length,
         results: relatedResults,
         nextSearchIndex: searchIndex + 1,
         hasMore: searchIndex + 1 < maxSearches,
         skipped: true,
         message: 'Busca já realizada anteriormente'
       });
     }

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

      // Estratégia: buscar nas páginas 2-5 do Google para encontrar empresas que precisam de serviços
      let allResults = [];

      for (let pageNum = 2; pageNum <= 5; pageNum++) {
        try {
          const startParam = (pageNum - 1) * 10; // Google usa start=10,20,30,40...
          const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10&start=${startParam}&hl=pt-BR`;
          console.log(`🌐 Página ${pageNum}: ${searchUrl}`);

          const response = await page.goto(searchUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });

          if (!response.ok()) {
            console.warn(`Página ${pageNum} falhou: HTTP ${response.status()}`);
            continue;
          }

          // Aguardar carregamento dos resultados
          await page.waitForSelector('div.g, div[data-ved], div.yuRUbf', { timeout: 10000 });
          await new Promise(resolve => setTimeout(resolve, 2000)); // Reduzido para múltiplas páginas

          // Extrair resultados desta página
          const pageResults = await page.evaluate(() => {
            const extractedResults = [];
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
                     !href.includes('maps.google.com');
            });

            for (let i = 0; i < Math.min(allLinks.length, 8); i++) { // 8 por página para total ~32
              const link = allLinks[i];
              const title = link.textContent?.trim() || link.querySelector('h3')?.textContent?.trim() || '';

              let finalTitle = title;
              if (!finalTitle) {
                const parent = link.closest('div.g') || link.closest('div[data-ved]');
                if (parent) {
                  const h3 = parent.querySelector('h3');
                  if (h3) finalTitle = h3.textContent?.trim();
                }
              }

              if (finalTitle && finalTitle.length > 2) { // Mais permissivo para páginas profundas
                const parent = link.closest('div.g') || link.closest('div[data-ved]');
                let description = '';
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
                  position: extractedResults.length + 1,
                  googlePage: pageNum
                });
              }
            }

            return extractedResults;
          });

          allResults = allResults.concat(pageResults);
          console.log(`📄 Página ${pageNum}: ${pageResults.length} resultados`);

          // Pequena pausa entre páginas para evitar detecção
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (pageError) {
          console.warn(`Erro na página ${pageNum}:`, pageError.message);
          continue;
        }
      }

      console.log(`📊 Total extraído de todas as páginas: ${allResults.length} resultados`);
      results = allResults;

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

      // Validação simplificada baseada no título e URL (sem abrir novas páginas para evitar sobrecarga)
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
            /tripadvisor/i, /yelp/i, /ifood/i, /uber eats/i,
            /restaurantes.*fortaleza/i, /melhores.*restaurantes/i,
            /top.*restaurantes/i, /guias.*restaurantes/i,
            /restaurante.*em.*fortaleza/i, /onde.*comer/i
          ];

          const shouldReject = rejectPatterns.some(pattern =>
            pattern.test(urlLower) || pattern.test(titleLower) || pattern.test(result.description)
          );

          if (shouldReject) {
            console.log(`❌ ${result.title} - Rejeitado: lista/diretório/notícia/redes sociais`);
            continue;
          }

          // Verificar se parece ser uma empresa individual baseada no título
          const businessIndicators = [
            /\b(restaurante|bar|lanchonete|pizzaria|hamburgueria|açaiteria|padaria|cafeteria)\b/i,
            /\b(advogado|escritório|dentista|clínica|psicólogo|nutricionista)\b/i,
            /\b(salão|barbearia|estética|manicure|depilação|spa)\b/i,
            /\b(academia|personal|crossfit|pilates|yoga|fisioterapia)\b/i,
            /\b(pet.*shop|veterinário|banho.*tosa)\b/i,
            /\b(mecânica|auto.*center|lava.*jato)\b/i,
            /\b(loja|boutique|moda|roupas|calçados|joalheria)\b/i,
            /\b(farmácia|drogaria|manipulação)\b/i,
            /\b(construtora|engenharia|reformas|pinturas|marcenaria)\b/i,
            /\b(contabilidade|consultoria|imobiliária|corretor)\b/i,
            /\b(escola|curso|idiomas|pré.*vestibular)\b/i,
            /\b(assistência.*técnica|informática|eletrônica)\b/i,
            /\b(fotografia|decoração|design|floricultura|chaveiro)\b/i
          ];

          const hasBusinessIndicator = businessIndicators.some(pattern =>
            pattern.test(titleLower) || pattern.test(result.description)
          );

          if (!hasBusinessIndicator) {
            console.log(`❌ ${result.title} - Rejeitado: não parece ser empresa comercial`);
            continue;
          }

          console.log(`✅ ${result.title} - Empresa potencial identificada`);
          validatedResults.push(result);

        } catch (validationError) {
          console.error(`❌ Erro na validação de ${result.title}:`, validationError.message);
          continue;
        }
      }

      console.log(`🎯 Após validação: ${validatedResults.length} empresas potenciais identificadas de ${results.length} links iniciais`);
      results = validatedResults;

      console.log(`📊 Extraídos ${results.length} resultados válidos`);

    } catch (browserError) {
      console.error('❌ Erro no browser:', browserError.message);
      console.log('❌ Nenhum resultado encontrado - Google pode estar bloqueando');
    }

    // Filtrar e validar resultados (mais permissivo para páginas profundas)
    const validResults = results.filter(r =>
      r.url &&
      !r.url.includes('google.com') &&
      !r.url.includes('youtube.com') &&
      !r.url.includes('facebook.com') &&
      !r.url.includes('wikipedia.org') &&
      (r.description.length > 5 || r.title.length > 3) // Mais permissivo
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

      // Marcar busca como concluída
      await storage.saveCompany(existingSearchKey, {
        searchTerm,
        neighborhood,
        businessType: business,
        completedAt: timestamp,
        resultsCount: validResults.length
      });

      // Cachear o resultado para futuras buscas
      await storage.setCachedSearchResult(searchTerm, {
        results: validResults,
        timestamp
      });

      // Atualizar estatísticas
      await storage.incrementStat('totalSearches', 1);
      await storage.incrementStat('totalResults', validResults.length);
      await storage.incrementNeighborhoodHits(neighborhood, validResults.length);
      await storage.incrementBusinessHits(business, validResults.length);

      // Atualizar sistema de aprendizado
      await updateLearning(searchTerm, neighborhood, business, 'google_search', validResults.length);
    } else {
      // Mesmo sem resultados, marcar busca como concluída e atualizar aprendizado
      const timestamp = Date.now();
      await storage.saveCompany(existingSearchKey, {
        searchTerm,
        neighborhood,
        businessType: business,
        completedAt: timestamp,
        resultsCount: 0
      });

      // Cachear resultado vazio
      await storage.setCachedSearchResult(searchTerm, {
        results: [],
        timestamp
      });

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

// Função para executar buscas em paralelo
async function performParallelSearches(startIndex, maxSearches, parallelCount, res) {
 const results = [];
 const errors = [];

 console.log(`🚀 Iniciando ${parallelCount} buscas em paralelo a partir do índice ${startIndex}`);

 // Criar promises para buscas paralelas
 const searchPromises = [];
 for (let i = 0; i < parallelCount && (startIndex + i) < maxSearches; i++) {
   const currentIndex = startIndex + i;
   searchPromises.push(performSingleSearch(currentIndex));
 }

 try {
   // Executar todas as buscas em paralelo
   const searchResults = await Promise.allSettled(searchPromises);

   // Processar resultados
   searchResults.forEach((result, index) => {
     if (result.status === 'fulfilled') {
       results.push(result.value);
     } else {
       errors.push({
         index: startIndex + index,
         error: result.reason.message
       });
     }
   });

   // Consolidar estatísticas
   const totalResults = results.reduce((sum, r) => sum + r.resultsFound, 0);
   const nextIndex = startIndex + parallelCount;

   return res.status(200).json({
     success: true,
     parallel: true,
     searchesPerformed: results.length,
     totalResults,
     results: results.flatMap(r => r.results),
     nextSearchIndex: nextIndex,
     hasMore: nextIndex < maxSearches,
     errors: errors.length > 0 ? errors : undefined,
     message: `Executadas ${results.length} buscas em paralelo`
   });

 } catch (error) {
   console.error('❌ Erro nas buscas paralelas:', error);
   return res.status(500).json({
     success: false,
     error: error.message,
     parallel: true
   });
 }
}

// Função auxiliar para executar uma busca individual
async function performSingleSearch(searchIndex) {
 // Gerar termo de busca
 const neighborhood = NEIGHBORHOODS[searchIndex % NEIGHBORHOODS.length];
 const business = BUSINESS_TYPES[Math.floor(searchIndex / NEIGHBORHOODS.length) % BUSINESS_TYPES.length];
 const searchTerm = `${business} ${neighborhood} fortaleza`;

 // Verificar cache primeiro
 const cachedResult = await storage.getCachedSearchResult(searchTerm);
 if (cachedResult) {
   console.log(`⚡ Resultado em cache encontrado: ${searchTerm}`);
   return {
     searchTerm,
     neighborhood,
     businessType: business,
     resultsFound: cachedResult.results.length,
     results: cachedResult.results,
     cached: true,
     message: 'Resultado obtido do cache'
   };
 }

 // Verificar se já existe busca
 const existingSearchKey = `search:${Buffer.from(searchTerm).toString('base64')}`;
 const existingSearch = await storage.getCompany(existingSearchKey);

 if (existingSearch && existingSearch.completedAt) {
   console.log(`🔄 Busca já realizada: ${searchTerm}`);
   const relatedResults = await storage.getCompaniesBySearchTerm(searchTerm);
   return {
     searchTerm,
     neighborhood,
     businessType: business,
     resultsFound: relatedResults.length,
     results: relatedResults,
     skipped: true,
     message: 'Busca já realizada anteriormente'
   };
 }

 // Executar busca real
 console.log(`🔍 Executando busca: ${searchTerm}`);

 let results = [];

 try {
   const browser = await getBrowser();
   const page = await browser.newPage();

   // Configurar headers
   await page.setExtraHTTPHeaders({
     'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
     'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
     'Accept-Encoding': 'gzip, deflate, br',
     'DNT': '1',
     'Connection': 'keep-alive',
     'Upgrade-Insecure-Requests': '1',
   });

   await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
   await page.setViewport({ width: 1366, height: 768 });
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

   await page.waitForSelector('div.g, div[data-ved], div.yuRUbf', { timeout: 15000 });
   await new Promise(resolve => setTimeout(resolve, 2000)); // Reduzido para paralelização

   // Extrair resultados (versão simplificada para paralelização)
   results = await page.evaluate(() => {
     const extractedResults = [];
     const allLinks = Array.from(document.querySelectorAll('a[href]')).filter(a => {
       const href = a.href;
       return href &&
              href.startsWith('http') &&
              !href.includes('google.com') &&
              !href.includes('youtube.com') &&
              !href.includes('wikipedia.org') &&
              !href.includes('facebook.com') &&
              !href.includes('instagram.com') &&
              !href.includes('linkedin.com');
     });

     for (let i = 0; i < Math.min(allLinks.length, 5); i++) { // Reduzido para paralelização
       const link = allLinks[i];
       const title = link.textContent?.trim() || link.querySelector('h3')?.textContent?.trim() || '';

       let finalTitle = title;
       if (!finalTitle) {
         const parent = link.closest('div.g') || link.closest('div[data-ved]');
         if (parent) {
           const h3 = parent.querySelector('h3');
           if (h3) finalTitle = h3.textContent?.trim();
         }
       }

       if (finalTitle && finalTitle.length > 3) {
         const parent = link.closest('div.g') || link.closest('div[data-ved]');
         let description = '';
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

         if (extractedResults.length >= 4) break; // Reduzido para paralelização
       }
     }

     return extractedResults;
   });

   await page.close();

 } catch (browserError) {
   console.error('❌ Erro no browser:', browserError.message);
 }

 // Validação simplificada
 const validatedResults = [];
 for (const result of results) {
   const urlLower = result.url.toLowerCase();
   const titleLower = result.title.toLowerCase();

   const rejectPatterns = [
     /lista.*empresa/i, /diretório/i, /notícia/i, /news/i,
     /facebook\.com/i, /instagram\.com/i, /youtube\.com/i,
     /mercadolivre/i, /olx/i, /wikipedia/i, /google/i
   ];

   const shouldReject = rejectPatterns.some(pattern =>
     pattern.test(urlLower) || pattern.test(titleLower)
   );

   if (!shouldReject) {
     const businessIndicators = [
       /\b(restaurante|advogado|dentista|salão|academia|pet|mecânica|loja)\b/i
     ];

     const hasBusinessIndicator = businessIndicators.some(pattern =>
       pattern.test(titleLower) || pattern.test(result.description)
     );

     if (hasBusinessIndicator) {
       validatedResults.push(result);
     }
   }
 }

 // Salvar resultados
 if (validatedResults.length > 0) {
   const timestamp = Date.now();

   for (const result of validatedResults) {
     const key = `company:${Buffer.from(result.url).toString('base64').substring(0, 50)}`;
     await storage.saveCompany(key, {
       ...result,
       searchTerm,
       neighborhood,
       businessType: business,
       foundAt: timestamp
     });
   }

   await storage.saveCompany(existingSearchKey, {
     searchTerm,
     neighborhood,
     businessType: business,
     completedAt: timestamp,
     resultsCount: validatedResults.length
   });

   await storage.setCachedSearchResult(searchTerm, {
     results: validatedResults,
     timestamp
   });

   await storage.incrementStat('totalSearches', 1);
   await storage.incrementStat('totalResults', validatedResults.length);
   await storage.incrementNeighborhoodHits(neighborhood, validatedResults.length);
   await storage.incrementBusinessHits(business, validatedResults.length);

   await updateLearning(searchTerm, neighborhood, business, 'google_search', validatedResults.length);
 } else {
   const timestamp = Date.now();
   await storage.saveCompany(existingSearchKey, {
     searchTerm,
     neighborhood,
     businessType: business,
     completedAt: timestamp,
     resultsCount: 0
   });

   await storage.setCachedSearchResult(searchTerm, {
     results: [],
     timestamp
   });

   await updateLearning(searchTerm, neighborhood, business, 'google_search', 0);
 }

 return {
   searchTerm,
   neighborhood,
   businessType: business,
   resultsFound: validatedResults.length,
   results: validatedResults
 };
}