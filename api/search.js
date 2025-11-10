import { storage } from './storage.js';
import { updateLearning, analyzeCompany } from './ai.js';

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
     const businessType = business; // Definir businessType explicitamente

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

    // Record performance metric
    const searchStartTime = Date.now();
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
          console.warn(`Erro na página ${pageNum}: ${pageError.message}`);
          continue;
        }
      }

      console.log(`📊 Total extraído de todas as páginas: ${allResults.length} resultados`);
      results = allResults;

      // Validação inteligente usando IA (removidos filtros hardcoded)
      const validatedResults = [];
      for (const result of results) {
        try {
          console.log(`🤖 Validando empresa com IA: ${result.title}`);

          // Análise básica inicial (muito permissiva)
          const urlLower = result.url.toLowerCase();
          const titleLower = result.title.toLowerCase();

          // Apenas rejeitar conteúdo claramente não-comercial
          const hardRejectPatterns = [
            /lista.*empresa/i, /diretório/i, /notícia/i, /news/i,
            /wikipedia/i, /google/i, /translate\.google/i, /maps\.google/i,
            /books\.google/i, /news\.google/i
          ];

          const shouldHardReject = hardRejectPatterns.some(pattern =>
            pattern.test(urlLower) || pattern.test(titleLower) || pattern.test(result.description)
          );

          if (shouldHardReject) {
            console.log(`❌ ${result.title} - Rejeitado: conteúdo não-comercial`);
            continue;
          }

          // Verificar se tem indicadores básicos de negócio
          const basicBusinessIndicators = [
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
            /\b(fotografia|decoração|design|floricultura|chaveiro)\b/i,
            /\b(facebook|instagram|linkedin|twitter|tiktok)\b/i, // Agora aceita redes sociais
            /\b(site|online|digital|ecommerce)\b/i // Indicadores digitais
          ];

          const hasBasicIndicator = basicBusinessIndicators.some(pattern =>
            pattern.test(titleLower) || pattern.test(result.description)
          );

          if (!hasBasicIndicator && result.title.length < 5) {
            console.log(`❌ ${result.title} - Rejeitado: sem indicadores básicos de negócio`);
            continue;
          }

          // Análise de IA para decisão final (mais permissiva)
          try {
            const aiValidation = await validateWithAI(result);
            if (aiValidation.isValid) {
              console.log(`✅ ${result.title} - Aprovado por IA: ${aiValidation.reason}`);
              validatedResults.push({
                ...result,
                aiValidation: aiValidation
              });
            } else {
              console.log(`❌ ${result.title} - Rejeitado por IA: ${aiValidation.reason}`);
            }
          } catch (aiError) {
            // Fallback: aceitar se tem indicadores básicos
            console.log(`🤔 ${result.title} - IA falhou, usando fallback`);
            if (hasBasicIndicator) {
              validatedResults.push(result);
            }
          }

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

    // Aplicar validação IA final e salvar apenas empresas aprovadas
    const aiValidatedResults = [];
    for (const result of validResults) {
      try {
        console.log(`🤖 Aplicando validação IA final para: ${result.title}`);
        const aiValidation = await validateWithAI(result);

        if (aiValidation.isValid) {
          console.log(`✅ ${result.title} - APROVADO pela IA: ${aiValidation.reason}`);
          aiValidatedResults.push({
            ...result,
            aiValidation: aiValidation
          });
        } else {
          console.log(`❌ ${result.title} - REJEITADO pela IA: ${aiValidation.reason}`);
        }
      } catch (aiError) {
        console.log(`🤔 ${result.title} - Erro na IA, mantendo por segurança`);
        // Em caso de erro na IA, manter o resultado (fallback permissivo)
        aiValidatedResults.push({
          ...result,
          aiValidation: {
            isValid: true,
            reason: 'Erro na validação IA - mantido por segurança',
            confidence: 30
          }
        });
      }
    }

    console.log(`🎯 Após validação IA: ${aiValidatedResults.length} empresas aprovadas de ${validResults.length} candidatos`);

    // Salvar apenas empresas aprovadas pela IA
    if (aiValidatedResults.length > 0) {
      const timestamp = Date.now();

      for (const result of aiValidatedResults) {
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
        resultsCount: aiValidatedResults.length
      });

      // Cachear apenas os resultados aprovados
      await storage.setCachedSearchResult(searchTerm, {
        results: aiValidatedResults,
        timestamp
      });

      // Atualizar estatísticas
      await storage.incrementStat('totalSearches', 1);
      await storage.incrementStat('totalResults', aiValidatedResults.length);
      await storage.incrementNeighborhoodHits(neighborhood, aiValidatedResults.length);
      await storage.incrementBusinessHits(business, aiValidatedResults.length);

      // Atualizar sistema de aprendizado
      await updateLearning(searchTerm, neighborhood, business, 'google_search', aiValidatedResults.length);
    } else {
      // Mesmo sem resultados aprovados, marcar busca como concluída
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

    // Record search performance
    const searchDuration = Date.now() - searchStartTime;
    await storage.updatePerformanceMetric('search_duration', searchDuration);
    await storage.updatePerformanceMetric('results_per_search', validResults.length);
    await storage.recordUserAction('search_completed', {
      searchTerm,
      neighborhood,
      businessType: business,
      resultsFound: validResults.length,
      duration: searchDuration
    });

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

// Função para validar empresa com IA
async function validateWithAI(companyData) {
  try {
    const prompt = `Analise se esta é uma empresa válida para prospecção comercial:

Empresa: ${companyData.title}
Descrição: ${companyData.description}
URL: ${companyData.url}

IMPORTANTE: Considere que empresas iniciantes frequentemente usam:
- Redes sociais (Facebook, Instagram, etc.) como presença inicial
- Sites simples ou landing pages
- Presença digital básica

Responda APENAS com JSON:
{
  "isValid": true/false,
  "reason": "breve explicação",
  "confidence": 0-100
}`;

    // Usar função de análise existente mas com prompt específico
    const analysis = await analyzeCompany({
      ...companyData,
      customPrompt: prompt
    });

    // Tentar extrair JSON da resposta
    try {
      const jsonMatch = analysis.analysis.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isValid: parsed.isValid || false,
          reason: parsed.reason || 'Análise inconclusiva',
          confidence: parsed.confidence || 50
        };
      }
    } catch (parseError) {
      // Fallback baseado no conteúdo da análise
      const content = analysis.analysis.toLowerCase();
      const isValid = !content.includes('não é') && !content.includes('inválid') &&
                     (content.includes('válid') || content.includes('empresa') ||
                      content.includes('comercial') || content.includes('negócio'));

      return {
        isValid: isValid,
        reason: isValid ? 'Análise positiva' : 'Análise negativa',
        confidence: 70
      };
    }

    // Fallback final
    return {
      isValid: true, // Mais permissivo por padrão
      reason: 'Análise inconclusiva - aceitando por segurança',
      confidence: 50
    };

  } catch (error) {
    console.error('Erro na validação IA:', error);
    return {
      isValid: true, // Fallback permissivo
      reason: 'Erro na IA - aceitando por segurança',
      confidence: 30
    };
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

 // Validação inteligente usando IA (removidos filtros hardcoded)
 const validatedResults = [];
 for (const result of results) {
   try {
     console.log(`🤖 Validando empresa com IA: ${result.title}`);

     // Análise básica inicial (muito permissiva)
     const urlLower = result.url.toLowerCase();
     const titleLower = result.title.toLowerCase();

     // Apenas rejeitar conteúdo claramente não-comercial
     const hardRejectPatterns = [
       /lista.*empresa/i, /diretório/i, /notícia/i, /news/i,
       /wikipedia/i, /google/i, /translate\.google/i, /maps\.google/i,
       /books\.google/i, /news\.google/i
     ];

     const shouldHardReject = hardRejectPatterns.some(pattern =>
       pattern.test(urlLower) || pattern.test(titleLower) || pattern.test(result.description)
     );

     if (shouldHardReject) {
       console.log(`❌ ${result.title} - Rejeitado: conteúdo não-comercial`);
       continue;
     }

     // Verificar se tem indicadores básicos de negócio
     const basicBusinessIndicators = [
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
       /\b(fotografia|decoração|design|floricultura|chaveiro)\b/i,
       /\b(facebook|instagram|linkedin|twitter|tiktok)\b/i, // Agora aceita redes sociais
       /\b(site|online|digital|ecommerce)\b/i // Indicadores digitais
     ];

     const hasBasicIndicator = basicBusinessIndicators.some(pattern =>
       pattern.test(titleLower) || pattern.test(result.description)
     );

     if (!hasBasicIndicator && result.title.length < 5) {
       console.log(`❌ ${result.title} - Rejeitado: sem indicadores básicos de negócio`);
       continue;
     }

     // Análise de IA para decisão final (mais permissiva)
     try {
       const aiValidation = await validateWithAI(result);
       if (aiValidation.isValid) {
         console.log(`✅ ${result.title} - Aprovado por IA: ${aiValidation.reason}`);
         validatedResults.push({
           ...result,
           aiValidation: aiValidation
         });
       } else {
         console.log(`❌ ${result.title} - Rejeitado por IA: ${aiValidation.reason}`);
       }
     } catch (aiError) {
       // Fallback: aceitar se tem indicadores básicos
       console.log(`🤔 ${result.title} - IA falhou, usando fallback`);
       if (hasBasicIndicator) {
         validatedResults.push(result);
       }
     }

   } catch (validationError) {
     console.error(`❌ Erro na validação de ${result.title}:`, validationError.message);
     continue;
   }
 }

 // Aplicar validação IA final para buscas paralelas
 const aiValidatedResults = [];
 for (const result of validatedResults) {
   try {
     console.log(`🤖 Validando empresa paralela: ${result.title}`);
     const aiValidation = await validateWithAI(result);

     if (aiValidation.isValid) {
       console.log(`✅ ${result.title} - Aprovado`);
       aiValidatedResults.push({
         ...result,
         aiValidation: aiValidation
       });
     } else {
       console.log(`❌ ${result.title} - Rejeitado: ${aiValidation.reason}`);
     }
   } catch (aiError) {
     console.log(`🤔 ${result.title} - IA falhou, mantendo`);
     aiValidatedResults.push({
       ...result,
       aiValidation: {
         isValid: true,
         reason: 'Erro na validação IA - mantido por segurança',
         confidence: 30
       }
     });
   }
 }

 console.log(`🎯 Busca paralela: ${aiValidatedResults.length} empresas aprovadas de ${validatedResults.length} candidatos`);

 // Salvar apenas empresas aprovadas pela IA
 if (aiValidatedResults.length > 0) {
   const timestamp = Date.now();

   for (const result of aiValidatedResults) {
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
     resultsCount: aiValidatedResults.length
   });

   await storage.setCachedSearchResult(searchTerm, {
     results: aiValidatedResults,
     timestamp
   });

   await storage.incrementStat('totalSearches', 1);
   await storage.incrementStat('totalResults', aiValidatedResults.length);
   await storage.incrementNeighborhoodHits(neighborhood, aiValidatedResults.length);
   await storage.incrementBusinessHits(business, aiValidatedResults.length);

   await updateLearning(searchTerm, neighborhood, business, 'google_search', aiValidatedResults.length);
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