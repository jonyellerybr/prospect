import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import dotenv from "dotenv";
import { Mistral } from "@mistralai/mistralai";

dotenv.config();

// ==================== CONFIGURAÇÕES ====================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const userDataDir = path.join(__dirname, "wp-profile");

const CONFIG = {
  // Suas chaves de API
  GEMINI_API_KEYS: (process.env.GEMINI_KEYS || "").split(",").map(k => k.trim()).filter(Boolean),
  MISTRAL_API_KEYS: (process.env.MISTRAL_KEYS || "").split(",").map(k => k.trim()).filter(Boolean),

  // Configurações de busca
  maxSearches: 30,
  maxResultsPerSearch: 8,
  delayBetweenSearches: 4000,
  delayBetweenClicks: 2000,
  headless: false,

  // Seus serviços
  myServices: [
    "Criação de Sites Profissionais",
    "Landing Pages de Alta Conversão",
    "Gestão de Tráfego Pago (Google Ads, Meta Ads)",
    "SEO e Otimização para Google",
    "Automação de WhatsApp e Chatbots",
    "Identidade Visual e Branding",
    "Consultoria em Marketing Digital"
  ],

  // Arquivos
  LEARNING_FILE: path.join(__dirname, "search_learning.json"),
  RESULTS_FILE: path.join(__dirname, "prospection_results.json"),
};

// Índices para rotação de chaves
let currentGeminiIndex = 0;
let currentMistralIndex = 0;

// ==================== BAIRROS DE FORTALEZA ====================
const FORTALEZA_NEIGHBORHOODS = [
  // Zona Nobre (Prioridade Alta - mais empresas)
  "Aldeota", "Meireles", "Mucuripe", "Varjota", "Papicu", "Praia de Iracema",
  "Cocó", "Luciano Cavalcante", "Dionísio Torres", "Joaquim Távora",
  
  // Centro e adjacências (Prioridade Alta)
  "Centro", "Benfica", "Fátima", "Parquelândia", "Rodolfo Teófilo",
  
  // Zona Sul (Prioridade Média)
  "Messejana", "Cambeba", "Cidade dos Funcionários", "Edson Queiroz",
  "Passaré", "Lagoa Redonda", "Sapiranga", "José de Alencar",
  
  // Outras regiões (Prioridade Média)
  "Parangaba", "Montese", "Maraponga", "Antônio Bezerra", "Bom Jardim",
  "Cajazeiras", "Vila Pery", "Serrinha", "Mondubim", "Itaperi",
  
  // Bairros em expansão (Oportunidades)
  "Dunas", "Salinas", "Sabiaguaba", "Água Fria", "Jangurussu",
  "Ancuri", "Pedras", "Guajeru", "Coaçu"
];

// ==================== TIPOS DE NEGÓCIOS ====================
const BUSINESS_TYPES = [
  // Alimentação
  "restaurante", "lanchonete", "pizzaria", "hamburgueria", "açaiteria",
  "padaria", "cafeteria", "bar", "petiscos", "delivery",
  
  // Serviços Profissionais
  "advogado", "escritório advocacia", "dentista", "clínica odontológica",
  "médico", "clínica médica", "psicólogo", "nutricionista",
  
  // Beleza e Estética
  "salão beleza", "barbearia", "estética", "manicure", "depilação",
  "clínica estética", "spa",
  
  // Fitness e Saúde
  "academia", "personal trainer", "crossfit", "pilates", "yoga",
  "fisioterapia", "quiropraxia",
  
  // Pet e Veterinária
  "pet shop", "veterinário", "banho e tosa", "hotel para pets",
  
  // Automotivo
  "mecânica", "auto center", "lava jato", "auto elétrica", "borracharia",
  
  // Varejo
  "loja roupas", "boutique", "moda feminina", "moda masculina",
  "calçados", "acessórios", "joalheria",
  
  // Farmácia e Saúde
  "farmácia", "drogaria", "manipulação",
  
  // Construção e Reformas
  "construtora", "engenharia", "reformas", "pinturas", "marcenaria",
  "vidraçaria", "serralheria",
  
  // Serviços Empresariais
  "contabilidade", "consultoria", "imobiliária", "corretor imóveis",
  "despachante", "advocacia empresarial",
  
  // Educação
  "escola", "curso", "reforço escolar", "idiomas", "pré-vestibular",
  
  // Tecnologia
  "assistência técnica", "informática", "eletrônica",
  
  // Outros Serviços
  "fotografia", "decoração", "design interiores", "móveis planejados",
  "floricultura", "chaveiro", "lavanderia"
];

// ==================== SISTEMA DE APRENDIZADO ====================
function loadLearningData() {
  try {
    if (fs.existsSync(CONFIG.LEARNING_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG.LEARNING_FILE, "utf8"));
    }
  } catch (error) {
    console.error("⚠️ Erro ao carregar dados de aprendizado:", error.message);
  }
  return {
    successfulSearches: [],
    failedSearches: [],
    bestNeighborhoods: {},
    bestBusinessTypes: {},
    bestStrategies: {},
    totalSearches: 0,
    successRate: 0
  };
}

function saveLearningData(data) {
  try {
    const tmp = `${CONFIG.LEARNING_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, CONFIG.LEARNING_FILE);
  } catch (error) {
    console.error("⚠️ Erro ao salvar dados de aprendizado:", error.message);
  }
}

function updateLearning(searchTerm, neighborhood, businessType, strategy, foundCompanies) {
  const learning = loadLearningData();

  // Ensure objects exist
  if (!learning.bestStrategies) learning.bestStrategies = {};
  if (!learning.bestNeighborhoods) learning.bestNeighborhoods = {};
  if (!learning.bestBusinessTypes) learning.bestBusinessTypes = {};

  // Ensure strategy is a string
  if (typeof strategy !== 'string') strategy = 'unknown';

  learning.totalSearches++;

  if (foundCompanies > 0) {
    learning.successfulSearches.push({
      term: searchTerm,
      neighborhood,
      businessType,
      strategy,
      companiesFound: foundCompanies,
      timestamp: new Date().toISOString()
    });

    learning.bestNeighborhoods[neighborhood] = (learning.bestNeighborhoods[neighborhood] || 0) + foundCompanies;
    learning.bestBusinessTypes[businessType] = (learning.bestBusinessTypes[businessType] || 0) + foundCompanies;
    learning.bestStrategies[strategy] = (learning.bestStrategies[strategy] || 0) + foundCompanies;
  } else {
    learning.failedSearches.push({
      term: searchTerm,
      neighborhood,
      businessType,
      strategy,
      timestamp: new Date().toISOString()
    });
  }

  learning.successRate = ((learning.successfulSearches.length / learning.totalSearches) * 100).toFixed(2);
  saveLearningData(learning);
  return learning;
}

// ==================== GERADOR INTELIGENTE DE TERMOS ====================
function generateSmartSearchTerms(maxTerms = 30) {
  const learning = loadLearningData();
  const searchTerms = [];

  // Ordenar bairros e tipos de negócio por performance
  const sortedNeighborhoods = Object.entries(learning.bestNeighborhoods || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  const sortedBusinessTypes = Object.entries(learning.bestBusinessTypes || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Ordenar estratégias por performance
  const sortedStrategies = Object.entries(learning.bestStrategies || {})
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Priorizar bairros e negócios que já deram resultado
  const priorityNeighborhoods = [
    ...sortedNeighborhoods.slice(0, 15),
    ...FORTALEZA_NEIGHBORHOODS.filter(n => !sortedNeighborhoods.includes(n)).slice(0, 15)
  ];

  const priorityBusinessTypes = [
    ...sortedBusinessTypes.slice(0, 20),
    ...BUSINESS_TYPES.filter(b => !sortedBusinessTypes.includes(b)).slice(0, 20)
  ];

  // Priorizar estratégias que deram resultado
  const priorityStrategies = sortedStrategies.length > 0 ?
    [...sortedStrategies.slice(0, 3), 'gmaps_local', 'social_media', 'new_business', 'direct_web'] :
    ['gmaps_local', 'social_media', 'new_business', 'direct_web'];

  console.log(`\n📊 SISTEMA DE APRENDIZADO ATIVO`);
  console.log(`   Total de buscas: ${learning.totalSearches}`);
  console.log(`   Taxa de sucesso: ${learning.successRate}%`);

  if (Object.keys(learning.bestNeighborhoods).length > 0) {
    console.log(`\n🏆 TOP 5 BAIRROS:`);
    Object.entries(learning.bestNeighborhoods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .forEach(([name, count], i) => {
        console.log(`   ${i + 1}. ${name} - ${count} empresas`);
      });
  }

  if (Object.keys(learning.bestStrategies).length > 0) {
    console.log(`\n🎯 TOP ESTRATÉGIAS:`);
    Object.entries(learning.bestStrategies)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .forEach(([name, count], i) => {
        console.log(`   ${i + 1}. ${name} - ${count} empresas`);
      });
  }

  // Distribuir termos baseado no aprendizado
  const strategyWeights = {};
  priorityStrategies.forEach((strategy, index) => {
    strategyWeights[strategy] = Math.max(1, 4 - index); // Estratégias melhores recebem mais peso
  });

  const totalWeight = Object.values(strategyWeights).reduce((sum, weight) => sum + weight, 0);

  // Gerar termos baseado nas estratégias priorizadas
  let termsGenerated = 0;
  for (const [strategy, weight] of Object.entries(strategyWeights)) {
    const strategyCount = Math.floor((weight / totalWeight) * maxTerms);
    if (strategyCount === 0) continue;

    for (let i = 0; i < strategyCount && termsGenerated < maxTerms; i++) {
      const neighborhood = priorityNeighborhoods[i % priorityNeighborhoods.length];
      const business = priorityBusinessTypes[i % priorityBusinessTypes.length];

      let term;
      switch (strategy) {
        case 'gmaps_local':
          term = `${business} ${neighborhood} fortaleza maps`;
          break;
        case 'social_media':
          term = `${business} ${neighborhood} site:instagram.com`;
          break;
        case 'new_business':
          const newModifiers = ["inauguração", "novo", "nova", "acabou de abrir", "recém inaugurado"];
          const modifier = newModifiers[i % newModifiers.length];
          term = `${business} ${modifier} ${neighborhood} fortaleza`;
          break;
        case 'direct_web':
          term = `${business} ${neighborhood} fortaleza -olx -mercadolivre`;
          break;
        default:
          term = `${business} ${neighborhood} fortaleza`;
      }

      searchTerms.push({
        term,
        neighborhood,
        businessType: business,
        platform: strategy === 'gmaps_local' ? 'google_maps' : 'google',
        strategy
      });

      termsGenerated++;
    }
  }

  return searchTerms;
}

// ==================== ROTAÇÃO DE CHAVES API ====================
function getNextGeminiKey() {
  if (!CONFIG.GEMINI_API_KEYS.length) {
    throw new Error("❌ Nenhuma chave Gemini configurada! Adicione GEMINI_KEYS no .env");
  }
  const key = CONFIG.GEMINI_API_KEYS[currentGeminiIndex];
  currentGeminiIndex = (currentGeminiIndex + 1) % CONFIG.GEMINI_API_KEYS.length;
  return key;
}

function getNextMistralKey() {
  if (!CONFIG.MISTRAL_API_KEYS.length) {
    throw new Error("❌ Nenhuma chave Mistral configurada! Adicione MISTRAL_KEYS no .env");
  }
  const key = CONFIG.MISTRAL_API_KEYS[currentMistralIndex];
  currentMistralIndex = (currentMistralIndex + 1) % CONFIG.MISTRAL_API_KEYS.length;
  return key;
}

// ==================== ANÁLISE COM IA ====================
async function analyzeWithAI(prompt, timeout = 20000) {
  // Tentar Gemini primeiro
  for (let attempt = 0; attempt < Math.min(3, CONFIG.GEMINI_API_KEYS.length); attempt++) {
    try {
      const key = getNextGeminiKey();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 }
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (!res.ok) {
        if (res.status === 429 || res.status === 401) continue;
        throw new Error(`Status ${res.status}`);
      }

      const result = await res.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;
    } catch (err) {
      console.error(`⚠️ Gemini tentativa ${attempt + 1}:`, err.message);
    }
  }

  // Fallback Mistral
  try {
    const key = getNextMistralKey();
    const client = new Mistral({ apiKey: key });
    const response = await client.chat.complete({
      model: "mistral-large-latest",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2048
    });
    return response?.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.error("❌ Mistral falhou:", err.message);
    return null;
  }
}

// ==================== VERIFICAÇÃO DE EMPRESA ====================
async function isCompanyWebsite(page, url, title) {
  console.log(`🏢 Verificando: ${title}`);

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(2000);

    const analysis = await page.evaluate(() => {
      const bodyText = document.body?.textContent?.toLowerCase() || '';
      const urlLower = window.location.href.toLowerCase();

      const positive = {
        contact: !!(document.querySelector('a[href*="tel:"], a[href*="mailto:"]') || 
                    bodyText.includes('contato') || bodyText.includes('telefone')),
        services: !!(bodyText.includes('serviço') || bodyText.includes('produto')),
        location: !!(bodyText.includes('endereço') || document.querySelector('iframe[src*="maps"]')),
        whatsapp: !!document.querySelector('a[href*="wa.me"], a[href*="whatsapp"]'),
        pricing: !!(bodyText.includes('preço') || bodyText.includes('orçamento'))
      };

      const negative = {
        news: !!(bodyText.includes('notícia') || urlLower.includes('/noticia/')),
        directory: !!(bodyText.includes('diretório') || bodyText.includes('lista de empresas')),
        social: !!(urlLower.includes('facebook.com') || urlLower.includes('instagram.com')),
        marketplace: !!(urlLower.includes('mercadolivre') || urlLower.includes('olx.com'))
      };

      const score = Object.values(positive).filter(Boolean).length - 
                    (Object.values(negative).filter(Boolean).length * 2);

      return { positive, negative, score, bodyPreview: bodyText.substring(0, 1000) };
    });

    if (analysis.negative.news || analysis.negative.directory || 
        analysis.negative.social || analysis.negative.marketplace) {
      console.log(`   ❌ Descartado: não é empresa comercial`);
      return false;
    }

    if (analysis.score >= 3) {
      console.log(`   ✅ Empresa confirmada (score: ${analysis.score})`);
      return true;
    }

    if (analysis.score <= 1) {
      console.log(`   ❌ Score muito baixo (${analysis.score})`);
      return false;
    }

    // Casos intermediários: consultar IA
    const prompt = `Analise se este é um site de empresa comercial real:

URL: ${url}
TÍTULO: ${title}
CONTEÚDO: ${analysis.bodyPreview}

Responda apenas SIM ou NÃO.`;

    const aiResponse = await analyzeWithAI(prompt, 10000);
    const isCompany = /^\s*SIM\b/i.test(aiResponse || '');
    console.log(`   ${isCompany ? '✅' : '❌'} IA decidiu: ${aiResponse}`);
    return isCompany;

  } catch (error) {
    console.error(`   ❌ Erro na verificação:`, error.message);
    return false;
  }
}

// ==================== ANÁLISE PROFUNDA ====================
async function analyzeWebsiteDeep(url, myServices) {
  console.log(`🔬 Análise profunda: ${url}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
    await page.waitForTimeout(3000);

    const siteInfo = await page.evaluate(() => {
      const title = document.title || '';
      const description = document.querySelector('meta[name="description"]')?.content || '';
      const bodyText = document.body?.innerText?.substring(0, 15000) || '';
      
      const headings = {
        h1: Array.from(document.querySelectorAll('h1')).map(h => h.textContent?.trim()).filter(Boolean),
        h2: Array.from(document.querySelectorAll('h2')).map(h => h.textContent?.trim()).filter(Boolean).slice(0, 5)
      };

      const contactInfo = {
        emails: Array.from(new Set(
          Array.from(document.querySelectorAll('a[href^="mailto:"]')).map(a => a.href.replace('mailto:', ''))
        )),
        phones: Array.from(new Set(
          Array.from(document.querySelectorAll('a[href^="tel:"]')).map(a => a.href.replace('tel:', ''))
        )),
        whatsapp: !!document.querySelector('a[href*="wa.me"], a[href*="whatsapp"]'),
        hasForm: !!document.querySelector('form input[type="email"]')
      };

      const social = {
        instagram: document.querySelector('a[href*="instagram.com"]')?.href || null,
        facebook: document.querySelector('a[href*="facebook.com"]')?.href || null
      };

      const tech = {
        hasSSL: window.location.protocol === 'https:',
        hasMobileMenu: !!document.querySelector('.mobile-menu, .hamburger'),
        hasAnalytics: /google-analytics|gtag/i.test(document.documentElement.innerHTML)
      };

      return { title, description, bodyText, headings, contactInfo, social, tech };
    });

    await browser.close();

    // Análise com IA
    const prompt = `Você é especialista em análise de websites para vendas consultivas.

🎯 MEUS SERVIÇOS:
${myServices.map((s, i) => `${i + 1}. ${s}`).join('\n')}

📊 DADOS DO WEBSITE:
URL: ${url}
Título: ${siteInfo.title}
Descrição: ${siteInfo.description}

📱 CONTATO:
- Emails: ${siteInfo.contactInfo.emails.join(', ') || 'Nenhum'}
- Telefones: ${siteInfo.contactInfo.phones.join(', ') || 'Nenhum'}
- WhatsApp: ${siteInfo.contactInfo.whatsapp ? 'Sim' : 'Não'}
- Formulário: ${siteInfo.contactInfo.hasForm ? 'Sim' : 'Não'}

🌐 REDES:
- Instagram: ${siteInfo.social.instagram || 'Não'}
- Facebook: ${siteInfo.social.facebook || 'Não'}

🔧 TECNOLOGIA:
- HTTPS: ${siteInfo.tech.hasSSL ? 'Sim' : 'Não'}
- Menu Mobile: ${siteInfo.tech.hasMobileMenu ? 'Sim' : 'Não'}
- Analytics: ${siteInfo.tech.hasAnalytics ? 'Sim' : 'Não'}

📝 TÍTULOS:
${[...siteInfo.headings.h1, ...siteInfo.headings.h2].slice(0, 10).join('\n')}

📄 CONTEÚDO:
${siteInfo.bodyText.substring(0, 3000)}

---

🎯 MISSÃO:
1. Identifique se é negócio PEQUENO/MÉDIO (ideal para venda)
2. Liste APENAS serviços que a empresa REALMENTE PRECISA
3. Seja ESPECÍFICO sobre problemas encontrados
4. Prioridade: 🔴 ALTA, 🟡 MÉDIA, 🟢 BAIXA

FORMATO:

🏢 PERFIL: [tipo de negócio e porte]

💎 OPORTUNIDADES:
🎯 SERVIÇO: [nome]
📊 PRIORIDADE: [emoji]
❌ PROBLEMA: [específico]
💡 SOLUÇÃO: [como resolver]
---

🎤 PITCH: [2-3 parágrafos de abordagem]

💰 POTENCIAL: [ALTO/MÉDIO/BAIXO] - [justificativa]`;

    const analysis = await analyzeWithAI(prompt, 25000);

    return {
      url,
      siteInfo,
      needsAnalysis: analysis || "❌ Análise não disponível",
      analyzedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error("❌ Erro na análise profunda:", error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

// ==================== BUSCA NO GOOGLE ====================
async function searchGoogle(page, searchTerm, maxPages = 3) {
  console.log(`\n🔍 Buscando: "${searchTerm}" (até ${maxPages} páginas)`);

  const allResults = [];
  let foundCompanies = 0;

  try {
    await page.setExtraHTTPHeaders({
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
    });

    // Buscar em múltiplas páginas
    for (let pageNum = 0; pageNum < maxPages; pageNum++) {
      const startParam = pageNum > 0 ? `&start=${pageNum * 10}` : '';
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10&hl=pt-BR${startParam}`;

      console.log(`   📄 Página ${pageNum + 1}: ${googleUrl}`);

      await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      console.log('⏳ Aguardando carregamento completo da página...');
      await page.waitForTimeout(3000);

      // Verificar CAPTCHA apenas na primeira página
      if (pageNum === 0) {
        const isLoggedIn = await page.evaluate(() => {
          const accountButton = document.querySelector('[aria-label*="Conta do Google"]') ||
                                document.querySelector('[data-ved*="1t:11943"]') ||
                                document.querySelector('a[href*="accounts.google.com"]');
          return accountButton !== null;
        });

        console.log(`🔐 Status do login: ${isLoggedIn ? 'Logado' : 'Não logado'}`);

        const hasCaptcha = await page.evaluate(() => {
          const bodyText = document.body.textContent.toLowerCase();
          return bodyText.includes('captcha') ||
                 bodyText.includes('verificação') ||
                 bodyText.includes('robot') ||
                 bodyText.includes('desculpe') ||
                 document.querySelector('[action*="captcha"]') !== null ||
                 document.querySelector('.captcha') !== null;
        });

        if (hasCaptcha) {
          console.log('⚠️ CAPTCHA ou bloqueio detectado!');
          if (isLoggedIn) {
            console.log('💡 Você está logado, mas ainda há bloqueio. Tentando continuar mesmo assim...');
            console.log('⏳ Aguardando 5 segundos para ver se resolve...');
            await page.waitForTimeout(5000);

            const stillHasCaptcha = await page.evaluate(() => {
              const bodyText = document.body.textContent.toLowerCase();
              return bodyText.includes('captcha') ||
                     bodyText.includes('verificação') ||
                     bodyText.includes('robot') ||
                     bodyText.includes('desculpe');
            });

            if (stillHasCaptcha) {
              console.log('⚠️ Bloqueio ainda presente. Continuando mesmo assim...');
            } else {
              console.log('✅ Bloqueio resolvido!');
            }
          } else {
            console.log('❌ Você não está logado. O login falhou.');
            return { results: [], foundCompanies: 0 };
          }
        } else {
          console.log('✅ Nenhum CAPTCHA detectado - sessão autenticada funcionando!');
        }
      }

      // Scroll para carregar mais resultados
      await page.evaluate(() => {
        window.scrollTo(0, 500);
      });
      await page.waitForTimeout(1000);

      await page.evaluate(() => {
        window.scrollTo(0, 1000);
      });
      await page.waitForTimeout(1000);

      const pageResults = await page.evaluate(() => {
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

        const extractedResults = [];
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
              title: finalTitle,
              url: link.href,
              description: description,
              searchTerm: window.location.search
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

      allResults.push(...pageResults);

      // Se encontramos empresas nesta página, continuar para a próxima
      // Se não encontramos nenhuma empresa válida nas últimas páginas, parar
      if (pageResults.length === 0 && pageNum > 0) {
        console.log(`   🛑 Parando navegação - página ${pageNum + 1} sem resultados`);
        break;
      }

      // Pequena pausa entre páginas
      if (pageNum < maxPages - 1) {
        await page.waitForTimeout(2000);
      }
    }

    console.log(`   ✅ ${allResults.length} resultados encontrados em ${maxPages} páginas`);
    return { results: allResults, foundCompanies: foundCompanies };

  } catch (error) {
    console.error(`   ❌ Erro na busca:`, error.message);
    return { results: [], foundCompanies: 0 };
  }
}

// ==================== ANÁLISE DE RESULTADOS ====================
async function analyzeSearchResults(page, results, searchTerm) {
  const validCompanies = [];
  
  for (let i = 0; i < Math.min(results.length, CONFIG.maxResultsPerSearch); i++) {
    const result = results[i];
    
    console.log(`\n📋 [${i + 1}/${results.length}] ${result.title}`);
    console.log(`   🌐 ${result.url.substring(0, 60)}...`);
    
    try {
      // Verificar se é empresa
      const isCompany = await isCompanyWebsite(page, result.url, result.title);
      
      if (!isCompany) {
        await page.waitForTimeout(CONFIG.delayBetweenClicks);
        continue;
      }

      // Análise profunda
      const analysis = await analyzeWebsiteDeep(result.url, CONFIG.myServices);

      if (analysis && analysis.needsAnalysis) {
        validCompanies.push({
          ...result,
          searchTerm,
          analysis: analysis.needsAnalysis,
          contactInfo: analysis.siteInfo.contactInfo,
          socialMedia: analysis.siteInfo.social,
          analyzedAt: new Date().toISOString()
        });
        
        console.log(`   ✨ EMPRESA VÁLIDA ADICIONADA!`);
      }

      await page.waitForTimeout(CONFIG.delayBetweenClicks);

    } catch (error) {
      console.error(`   ❌ Erro:`, error.message);
    }
  }

  return validCompanies;
}

// ==================== SALVAR RESULTADOS ====================
function saveResults(results) {
  try {
    fs.writeFileSync(CONFIG.RESULTS_FILE, JSON.stringify(results, null, 2));
    console.log(`\n💾 Resultados salvos: ${CONFIG.RESULTS_FILE}`);
  } catch (error) {
    console.error("❌ Erro ao salvar:", error.message);
  }
}

function loadResults() {
  try {
    if (fs.existsSync(CONFIG.RESULTS_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG.RESULTS_FILE, "utf8"));
    }
  } catch (error) {
    console.error("⚠️ Erro ao carregar resultados:", error.message);
  }
  return [];
}

// ==================== FUNÇÃO PRINCIPAL ====================
async function main() {
  console.log("\n" + "=".repeat(70));
  console.log("🚀 SISTEMA INTELIGENTE DE PROSPECÇÃO - FORTALEZA");
  console.log("=".repeat(70));
  console.log(`📅 ${new Date().toLocaleString('pt-BR')}`);
  console.log("=".repeat(70) + "\n");

  let browser;
  let allResults = loadResults();
  console.log(`📋 Iniciando com ${allResults.length} resultados existentes`);

  try {
    // Carregar dados de aprendizado existentes
    console.log("📚 Carregando dados de aprendizado...");
    const existingLearning = loadLearningData();
    console.log(`📊 Dados carregados: ${existingLearning.totalSearches} buscas anteriores, taxa de sucesso: ${existingLearning.successRate}%`);

    // Carregar resultados existentes
    console.log("📋 Carregando resultados anteriores...");
    const existingResults = loadResults();
    console.log(`📈 ${existingResults.length} empresas já encontradas anteriormente\n`);

    // Gerar termos inteligentes
    console.log("🧠 Gerando termos de busca com IA...");
    const searchTerms = generateSmartSearchTerms(CONFIG.maxSearches);
    console.log(`✅ ${searchTerms.length} termos gerados\n`);

    // Iniciar browser
    console.log("🌐 Iniciando navegador...");
    browser = await chromium.launch({
      headless: CONFIG.headless,
      args: [
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
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      userDataDir: userDataDir,
      locale: 'pt-BR',
      timezoneId: 'America/Fortaleza',
      permissions: ['geolocation'],
      geolocation: { latitude: -3.7319, longitude: -38.5267 },
      extraHTTPHeaders: {
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    console.log("✅ Pronto!\n");

    // Lançar navegador e fazer login no Gmail primeiro
    const loginPage = await context.newPage();
    loginPage.setDefaultTimeout(60000);

    console.log("🔐 Abrindo Gmail para login...");
    await loginPage.goto('https://mail.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log("⏳ Por favor, faça login no Gmail no navegador aberto (você tem 5 minutos)...");
    console.log("💡 Dica: Se aparecer 'Este navegador pode não ser seguro', clique em 'Avançado' > 'Ir para mail.google.com (não seguro)'");
    console.log("💡 Após login, deixe a página aberta - o script continuará automaticamente");

    try {
      await loginPage.waitForFunction(() => {
        const url = window.location.href;
        return url.includes('mail.google.com') && !url.includes('signin') && !url.includes('accounts.google.com');
      }, { timeout: 300000 });
      console.log("✅ Login no Gmail detectado! Aguardando 10 segundos para estabilizar...");
      await loginPage.waitForTimeout(10000);
    } catch (error) {
      console.log("⚠️ Timeout no login do Gmail. Tentando continuar mesmo assim...");
    }

    // Não fechar a aba de login, manter aberta para manter a sessão

    // Loop de prospecção
    for (let i = 0; i < searchTerms.length; i++) {
      const item = searchTerms[i];

      console.log(`\n${'='.repeat(70)}`);
      console.log(`📊 BUSCA ${i + 1}/${searchTerms.length}`);
      console.log(`   🎯 ${item.term}`);
      console.log(`   🏙️ Bairro: ${item.neighborhood}`);
      console.log(`   🧩 Tipo: ${item.businessType}`);
      console.log(`   🔍 Estratégia: ${item.strategy}`);
      console.log("=".repeat(70));

      // Busca Google (agora retorna objeto com results e foundCompanies)
      const searchResult = await searchGoogle(page, item.term);
      const results = searchResult.results;

      // Se não encontrou resultados suficientes, marcar como falha e continuar
      if (results.length < 3) {
        console.log(`   ⚠️ Poucos resultados encontrados (${results.length}). Marcando como estratégia pouco efetiva.`);
        updateLearning(item.term, item.neighborhood, item.businessType, item.strategy, 0);
        continue;
      }

      // Analisar resultados
      const validCompanies = await analyzeSearchResults(page, results, item.term);

      if (validCompanies.length > 0) {
        // Verificar duplicatas antes de adicionar
        const uniqueNewCompanies = validCompanies.filter(newCompany =>
          !allResults.some(existing => existing.url === newCompany.url)
        );

        if (uniqueNewCompanies.length > 0) {
          allResults.push(...uniqueNewCompanies);
          saveResults(allResults);
          console.log(`   ✨ ${uniqueNewCompanies.length} novas empresas adicionadas (total: ${allResults.length})`);
        } else {
          console.log(`   ℹ️ Todas as empresas encontradas já existiam no banco de dados`);
        }
      }

      // Atualizar aprendizado
      updateLearning(
        item.term,
        item.neighborhood,
        item.businessType,
        item.strategy,
        validCompanies.length
      );

      console.log(`⏳ Aguardando ${CONFIG.delayBetweenSearches / 1000}s antes da próxima busca...\n`);
      await page.waitForTimeout(CONFIG.delayBetweenSearches);
    }

    console.log("\n🎉 Todas as buscas concluídas!");
    console.log(`📈 Total de empresas encontradas: ${allResults.length}`);

    // Mostrar estatísticas finais
    const uniqueUrls = new Set(allResults.map(r => r.url));
    console.log(`📊 Estatísticas finais:`);
    console.log(`   - Empresas únicas: ${uniqueUrls.size}`);
    console.log(`   - Total de análises: ${allResults.length}`);
    console.log(`   - Arquivo salvo: ${CONFIG.RESULTS_FILE}`);

  } catch (error) {
    console.error("❌ Erro geral:", error.message);
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n💾 Finalizando e salvando resultados...");
  saveResults(allResults);
  console.log("✅ Processo concluído com sucesso!\n");
}

// ==================== EXECUÇÃO DIRETA ====================
if (__filename === process.argv[1]) {
  main().catch(err => console.error("❌ Erro fatal:", err));
}