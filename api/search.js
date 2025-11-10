import { storage } from './storage.js';
import { chromium } from 'playwright';
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

    let results = [];

    // Usar Playwright com Chromium otimizado para Vercel
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });

      const page = await browser.newPage();
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      });

      // Buscar no Google
      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTerm)}&num=10&hl=pt-BR`;
      console.log(`🌐 Acessando: ${googleUrl}`);

      await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Extrair resultados
      const results = await page.evaluate(() => {
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

          if (finalTitle && finalTitle.length > 3) {
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
              position: i + 1
            });

            if (extractedResults.length >= 6) break;
          }
        }

        console.log(`📊 Total de resultados válidos extraídos: ${extractedResults.length}`);
        return extractedResults;
      });

      await browser.close();

    } catch (browserError) {
      console.error('❌ Erro no browser:', browserError);
      // Fallback para fetch + cheerio se Playwright falhar
      console.log('🔄 Tentando fallback com fetch + cheerio...');

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

      // Extrair resultados do Google com cheerio
      const results = [];
      $('div.g, div[data-ved]').each((index, element) => {
        if (index >= 8) return;

        const titleEl = $(element).find('h3');
        const linkEl = $(element).find('a[href]');
        const descEl = $(element).find('span[data-ved], .VwiC3b').first();

        if (titleEl.length && linkEl.length) {
          const title = titleEl.text().trim();
          const url = linkEl.attr('href');
          const description = descEl.length ? descEl.text().trim() : '';

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