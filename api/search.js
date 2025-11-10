import { storage } from './storage.js';
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';

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

    // Usar scraping direto com fetch + cheerio (mais leve para Vercel)
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.8,en-US;q=0.5,en;q=0.3',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      timeout: 10000
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extrair resultados do Google
    const results = [];
    $('div.g').each((index, element) => {
      if (index >= 8) return; // Limitar a 8 resultados

      const titleEl = $(element).find('h3');
      const linkEl = $(element).find('a[href]');
      const descEl = $(element).find('span[data-ved], div[data-ved]').first();

      if (titleEl.length && linkEl.length) {
        const title = titleEl.text().trim();
        const url = linkEl.attr('href');
        const description = descEl.length ? descEl.text().trim() : '';

        // Filtrar URLs válidas
        if (url && url.startsWith('http') && !url.includes('google.com') && !url.includes('youtube.com')) {
          results.push({
            title,
            url,
            description,
            position: index + 1
          });
        }
      }
    });

    // Filtrar e validar resultados
    const validResults = results.filter(r =>
      r.url &&
      !r.url.includes('google.com') &&
      !r.url.includes('youtube.com') &&
      !r.url.includes('facebook.com') &&
      (r.description.length > 20 || r.title.length > 10)
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