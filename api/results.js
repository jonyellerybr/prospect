import { storage } from './storage.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
      const {
        limit = 50,
        offset = 0,
        includeSearches = false,
        neighborhood = '',
        businessType = '',
        dateRange = '',
        sortBy = 'date'
      } = req.query;

      // Buscar todas as empresas
      const allCompanies = await storage.getAllCompanies();

      // Separar empresas e buscas
      let companies = allCompanies.filter(company => company.foundAt);
      const searches = allCompanies.filter(company => company.completedAt && !company.foundAt);

      // Aplicar filtros
      if (neighborhood) {
        companies = companies.filter(company => company.neighborhood === neighborhood);
      }

      if (businessType) {
        companies = companies.filter(company => company.businessType === businessType);
      }

      if (dateRange) {
        const now = Date.now();
        let timeThreshold;

        switch (dateRange) {
          case 'today':
            timeThreshold = now - (24 * 60 * 60 * 1000); // 24h
            break;
          case 'week':
            timeThreshold = now - (7 * 24 * 60 * 60 * 1000); // 7 dias
            break;
          case 'month':
            timeThreshold = now - (30 * 24 * 60 * 60 * 1000); // 30 dias
            break;
          default:
            timeThreshold = 0;
        }

        companies = companies.filter(company => (company.foundAt || 0) >= timeThreshold);
      }

      // Aplicar ordenação
      switch (sortBy) {
        case 'name':
          companies.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
          break;
        case 'neighborhood':
          companies.sort((a, b) => (a.neighborhood || '').localeCompare(b.neighborhood || ''));
          break;
        case 'date':
        default:
          companies.sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0));
          break;
      }

      // Ordenar buscas por data (mais recentes primeiro)
      const sortedSearches = searches
        .filter(Boolean)
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

      // Paginar empresas
      const paginatedResults = companies.slice(offset, offset + parseInt(limit));

      // Buscar estatísticas
      const stats = await storage.getStats();

      // Buscar dados de aprendizado
      const learning = await storage.getLearningData();

      const response = {
        success: true,
        total: companies.length,
        results: paginatedResults,
        stats: {
          totalSearches: parseInt(stats.totalSearches || 0),
          totalResults: parseInt(stats.totalResults || 0),
          uniqueCompanies: companies.length,
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
          hasMore: companies.length > offset + parseInt(limit)
        }
      };

      // Incluir lista de buscas anteriores se solicitado
      if (includeSearches === 'true') {
        response.previousSearches = sortedSearches.map(search => ({
          searchTerm: search.searchTerm,
          neighborhood: search.neighborhood,
          businessType: search.businessType,
          completedAt: search.completedAt,
          resultsCount: search.resultsCount || 0
        }));
      }

      return res.status(200).json(response);

    } catch (error) {
      console.error('❌ Erro ao buscar resultados:', error);
      return res.status(500).json({
        success: false,
        error: error.message
      });
    }
}