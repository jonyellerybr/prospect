import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { storage } from './storage.js';

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

    // Inicializar Puppeteer com Chromium externo
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();

    // Configurar cabeçalhos
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'pt-BR,pt;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    // Buscar no Google
    await page.goto(`https://www.google.com/search?q=${encodeURIComponent(searchTerm)}`, {
      waitUntil: 'networkidle0',
      timeout: 30000
    });

    // Extrair resultados
    const results = await page.evaluate(() => {
      const items = [];
      const searchResults = document.querySelectorAll('div.g');

      searchResults.forEach((result, index) => {
        if (index >= 8) return;

        const titleEl = result.querySelector('h3');
        const linkEl = result.querySelector('a');
        const descEl = result.querySelector('div.VwiC3b');

        if (titleEl && linkEl) {
          items.push({
            title: titleEl.textContent,
            url: linkEl.href,
            description: descEl ? descEl.textContent : '',
            position: index + 1
          });
        }
      });

      return items;
    });

    await browser.close();

    // Filtrar e validar resultados
    const validResults = results.filter(r => 
      r.url &&
      !r.url.includes('google.com') &&
      !r.url.includes('youtube.com') &&
      !r.url.includes('facebook.com') &&
      (r.description.length > 50 || r.title.length > 20)
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