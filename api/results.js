import { storage } from './storage.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { limit = 50, offset = 0 } = req.query;

    // Buscar todas as empresas
    const allCompanies = await storage.getAllCompanies();

    // Ordenar por data (mais recentes primeiro)
    const sortedResults = allCompanies
      .filter(Boolean)
      .sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));

    // Paginar
    const paginatedResults = sortedResults.slice(offset, offset + parseInt(limit));

    // Buscar estatísticas
    const stats = await storage.getStats();

    // Buscar dados de aprendizado
    const learning = await storage.getLearningData();

    return res.status(200).json({
      success: true,
      total: sortedResults.length,
      results: paginatedResults,
      stats: {
        totalSearches: parseInt(stats.totalSearches || 0),
        totalResults: parseInt(stats.totalResults || 0),
        uniqueCompanies: allCompanies.length,
        averagePerSearch: stats.totalSearches > 0
          ? (parseInt(stats.totalResults || 0) / parseInt(stats.totalSearches || 0)).toFixed(2)
          : 0,
        learning: {
          successRate: learning.successRate + '%',
          totalLearningSearches: learning.totalSearches,
          successfulSearches: learning.successfulSearches?.length || 0,
          failedSearches: learning.failedSearches?.length || 0
        }
      },
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: sortedResults.length > offset + parseInt(limit)
      }
    });

  } catch (error) {
    console.error('❌ Erro ao buscar resultados:', error);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}