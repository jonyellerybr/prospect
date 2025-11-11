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
  "Centro", "Benfica", "Messejana", "Parangaba", "Cocó",
  "Joaquim Távora", "Dionísio Torres", "São João do Tauape",
  "Cidade dos Funcionários", "Engenheiro Luciano Cavalcante",
  "Passaré", "Fátima", "Montese", "Barra do Ceará",
  "Praia do Futuro", "Jacarecanga", "Serrinha", "Cristo Redentor",
  "Vila Velha", "Pirambu", "Cais do Porto", "Vicente Pinzón",
  "José Bonifácio", "Henrique Jorge", "Planalto Ayrton Senna",
  "Bom Jardim", "Canindezinho", "Siqueira", "Itaperi",
  "Mondubim", "São Gerardo", "Jardim Cearense", "Jardim das Oliveiras"
];

const BUSINESS_TYPES = [
  "restaurante", "advogado", "dentista", "salão beleza",
  "academia", "pet shop", "mecânica", "loja roupas",
  "barbearia", "psicólogo", "nutricionista", "fisioterapeuta",
  "clínica veterinária", "lava jato", "borracharia", "chaveiro",
  "encanador", "eletricista", "pintor", "marceneiro",
  "construtora", "imobiliária", "contabilidade", "consultoria",
  "escola", "curso", "fotografia", "decoração",
  "floricultura", "hotel", "motel", "pousada",
  "livraria", "papelaria", "farmácia", "drogaria",
  "supermercado", "padaria", "açaiteria", "sorveteria",
  "churrascaria", "pizzaria", "lanchonete", "cafeteria",
  "hamburgueria", "sushi", "comida japonesa", "comida italiana",
  "comida chinesa", "comida mexicana", "comida árabe", "comida vegetariana",
  "massagista", "terapeuta", "personal trainer", "pilates",
  "yoga", "dança", "artes marciais", "natação",
  "joalheria", "perfumaria", "cosméticos", "bijuteria",
  "material construção", "ferramentas", "eletrodomésticos", "informática",
  "celulares", "acessórios", "brinquedos", "artigos festa",
  "limpeza", "higiene", "bebidas", "conveniência"
];

export default async function handler(req, res) {
   if (req.method !== 'POST') {
     return res.status(405).json({ error: 'Method not allowed' });
   }

   try {
     const { searchIndex = 0, maxSearches = 5 } = req.body;


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

     let searchPage = 1; // Página padrão

     if (existingSearch && existingSearch.completedAt) {
       // Se já foi pesquisado na página 1, tentar página 2
       if (!existingSearch.page2CompletedAt) {
         console.log(`🔄 Busca já realizada na página 1, tentando página 2: ${searchTerm}`);
         searchPage = 2;
       } else {
         console.log(`🔄 Busca já realizada em ambas as páginas: ${searchTerm}`);

         // Buscar resultados associados a esta busca (páginas 1 e 2)
         const allCompanies = await storage.getAllCompanies();
         const relatedResults = allCompanies.filter(company =>
           company.searchTerm === searchTerm && company.foundAt
         );

         // Cachear o resultado completo para futuras buscas
         await storage.setCachedSearchResult(searchTerm, {
           results: relatedResults,
           timestamp: Date.now(),
           pagesCompleted: 2
         });

         // Atualizar estatísticas mesmo para buscas puladas
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
           message: 'Busca já realizada em ambas as páginas'
         });
       }
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

      // Estratégia simplificada: buscar apenas na primeira página do Google
      let allResults = [];

      try {
        // Construir URL com paginação se necessário
        let searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10&hl=pt-BR`;

        if (searchPage === 2) {
          // Para página 2: adicionar parâmetro start=10
          searchUrl += `&start=10`;
          console.log(`📄 Buscando página 2 do Google`);
        }

        console.log(`🌐 Acessando: ${searchUrl}`);

        const response = await page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000
        });

        if (!response.ok()) {
          throw new Error(`HTTP ${response.status()}: ${response.statusText()}`);
        }

        // Aguardar carregamento dos resultados
        await page.waitForSelector('div.g, div[data-ved], div.yuRUbf', { timeout: 15000 });
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Extrair resultados usando estratégia robusta
        const pageResults = await page.evaluate(() => {
          const extractedResults = [];

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
                   !href.includes('news.google.com') &&
                   !href.includes('tripadvisor.com') &&
                   !href.includes('ifood.com') &&
                   !href.includes('uber.com');
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

        allResults = allResults.concat(pageResults);
        console.log(`📄 Extraídos ${pageResults.length} resultados da primeira página`);

      } catch (pageError) {
        console.warn(`Erro na extração: ${pageError.message}`);
      }

      console.log(`📊 Total extraído: ${allResults.length} resultados`);
      results = allResults;

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
            /restaurante.*em.*fortaleza/i, /onde.*comer/i,
            /polo.*gastronômico/i, /10.*restaurantes/i, /restaurantes.*nas.*proximidades/i
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
            /\b(restaurante|bar|lanchonete|pizzaria|hamburgueria|açaiteria|padaria|cafeteria|churrascaria|sorveteria)\b/i,
            /\b(advogado|escritório|dentista|clínica|psicólogo|nutricionista)\b/i,
            /\b(salão|barbearia|estética|manicure|depilação|spa)\b/i,
            /\b(academia|personal|crossfit|pilates|yoga|fisioterapia)\b/i,
            /\b(pet.*shop|veterinário|banho.*tosa|petshop)\b/i,
            /\b(mecânica|auto.*center|lava.*jato|borracharia)\b/i,
            /\b(loja|boutique|moda|roupas|calçados|joalheria|perfumaria)\b/i,
            /\b(farmácia|drogaria|manipulação)\b/i,
            /\b(construtora|engenharia|reformas|pinturas|marcenaria|eletricista)\b/i,
            /\b(contabilidade|consultoria|imobiliária|corretor)\b/i,
            /\b(escola|curso|idiomas|pré.*vestibular|cursinho)\b/i,
            /\b(assistência.*técnica|informática|eletrônica|celular)\b/i,
            /\b(fotografia|decoração|design|floricultura|chaveiro|encanador)\b/i,
            /\b(hotel|motel|pousada|hostel)\b/i,
            /\b(livraria|papelaria|material.*escolar)\b/i
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

    // Filtrar e validar resultados
    const validResults = results.filter(r =>
      r.url &&
      !r.url.includes('google.com') &&
      !r.url.includes('youtube.com') &&
      (r.description.length > 10 || r.title.length > 5)
    );

    console.log(`📊 Extraídos ${validResults.length} resultados válidos`);

    // Salvar no JSON storage e atualizar aprendizado
    console.log(`💾 Salvando ${validResults.length} resultados válidos...`);

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

      // Marcar busca como concluída (atualizar ou criar registro)
      const searchRecord = existingSearch || {};
      searchRecord.searchTerm = searchTerm;
      searchRecord.neighborhood = neighborhood;
      searchRecord.businessType = business;

      if (searchPage === 1) {
        searchRecord.completedAt = timestamp;
        searchRecord.page1Results = validResults.length;
      } else if (searchPage === 2) {
        searchRecord.page2CompletedAt = timestamp;
        searchRecord.page2Results = validResults.length;
      }

      searchRecord.resultsCount = (searchRecord.page1Results || 0) + (searchRecord.page2Results || 0);

      await storage.saveCompany(existingSearchKey, searchRecord);

      // Atualizar estatísticas
      await storage.incrementStat('totalSearches', 1);
      await storage.incrementStat('totalResults', validResults.length);
      await storage.incrementNeighborhoodHits(neighborhood, validResults.length);
      await storage.incrementBusinessHits(business, validResults.length);

      // Atualizar sistema de aprendizado
      await updateLearning(searchTerm, neighborhood, business, `google_search_page_${searchPage}`, validResults.length);

      console.log(`✅ Busca concluída: ${validResults.length} empresas salvas`);
    } else {
      // Mesmo sem resultados, atualizar aprendizado para estratégia pouco efetiva
      await updateLearning(searchTerm, neighborhood, business, `google_search_page_${searchPage}`, 0);
      console.log(`⚠️ Busca concluída sem resultados válidos`);
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


