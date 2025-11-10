import { storage } from './storage.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Estatísticas gerais
    const stats = await storage.getStats();

    // Top bairros
    const neighborhoods = Object.entries(stats.neighborhoods || {})
      .map(([name, hits]) => ({ name, hits: parseInt(hits || 0) }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);

    // Top tipos de negócio
    const businesses = Object.entries(stats.businesses || {})
      .map(([name, hits]) => ({ name, hits: parseInt(hits || 0) }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, 10);

    // Total de empresas únicas
    const allCompanies = await storage.getAllCompanies();

    // Buscar dados de aprendizado
    const learning = await storage.getLearningData();

    return res.status(200).json({
      success: true,
      general: {
        totalSearches: parseInt(stats.totalSearches || 0),
        totalResults: parseInt(stats.totalResults || 0),
        uniqueCompanies: allCompanies.length,
        averagePerSearch: stats.totalSearches > 0
          ? (parseInt(stats.totalResults || 0) / parseInt(stats.totalSearches || 0)).toFixed(2)
          : 0
      },
      learning: {
        successRate: learning.successRate + '%',
        totalLearningSearches: learning.totalSearches,
        successfulSearches: learning.successfulSearches?.length || 0,
        failedSearches: learning.failedSearches?.length || 0,
        topNeighborhoods: Object.entries(learning.bestNeighborhoods || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name, score]) => ({ name, score })),
        topStrategies: Object.entries(learning.bestStrategies || {})
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([name, score]) => ({ name, score }))
      },
      topNeighborhoods: neighborhoods,
      topBusinesses: businesses,
      lastUpdate: Date.now()
    });

  } catch (error) {
    console.error('❌ Erro ao buscar estatísticas:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}