import { storage } from './storage.js';
import { analyzeCompany, generateProspectingReport, analyzeCompanyDeep, updateLearning, generateSmartSearchTerms } from './ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, companyId, limit = 10 } = req.body;

    if (action === 'analyze_company' && companyId) {
      // Verificar cache primeiro
      const cachedAnalysis = await storage.getCachedCompanyAnalysis(companyId);
      if (cachedAnalysis) {
        console.log(`⚡ Análise em cache encontrada para empresa: ${companyId}`);
        return res.status(200).json({
          success: true,
          analysis: cachedAnalysis,
          cached: true
        });
      }

      // Buscar empresa específica
      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada' });
      }

      // Analisar empresa com IA
      const analysis = await analyzeCompany(company);

      // Salvar análise no cache
      await storage.setCachedCompanyAnalysis(companyId, analysis);

      // Salvar análise na empresa
      company.aiAnalysis = analysis;
      await storage.saveCompany(companyId, company);

      return res.status(200).json({
        success: true,
        analysis: analysis
      });
    }

    if (action === 'generate_report') {
      // Buscar empresas recentes para relatório
      const allCompanies = await storage.getAllCompanies();
      const recentCompanies = allCompanies
        .sort((a, b) => (b.foundAt || 0) - (a.foundAt || 0))
        .slice(0, limit);

      if (recentCompanies.length === 0) {
        return res.status(400).json({ error: 'Nenhuma empresa encontrada para gerar relatório' });
      }

      // Gerar relatório com IA
      const report = await generateProspectingReport(recentCompanies);

      return res.status(200).json({
        success: true,
        report: report,
        companiesAnalyzed: recentCompanies.length
      });
    }

    if (action === 'analyze_company_deep' && companyId) {
      // Verificar cache primeiro
      const cachedAnalysis = await storage.getCachedCompanyAnalysis(`${companyId}_deep`);
      if (cachedAnalysis) {
        console.log(`⚡ Análise profunda em cache encontrada para empresa: ${companyId}`);
        return res.status(200).json({
          success: true,
          analysis: cachedAnalysis,
          cached: true
        });
      }

      // Buscar empresa específica
      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada' });
      }

      // Análise profunda com IA
      const analysis = await analyzeCompanyDeep(company);

      // Salvar análise no cache
      await storage.setCachedCompanyAnalysis(`${companyId}_deep`, analysis);

      // Salvar análise profunda na empresa
      company.deepAnalysis = analysis;
      await storage.saveCompany(companyId, company);

      return res.status(200).json({
        success: true,
        analysis: analysis
      });
    }

    if (action === 'generate_smart_terms') {
      const maxTerms = req.body.maxTerms || 30;
      const searchTerms = await generateSmartSearchTerms(maxTerms);

      return res.status(200).json({
        success: true,
        searchTerms: searchTerms,
        totalTerms: searchTerms.length
      });
    }

    if (action === 'update_learning') {
      const { searchTerm, neighborhood, businessType, strategy, foundCompanies } = req.body;

      if (!searchTerm || !neighborhood || !businessType || !strategy) {
        return res.status(400).json({ error: 'Parâmetros obrigatórios: searchTerm, neighborhood, businessType, strategy' });
      }

      const learning = await updateLearning(searchTerm, neighborhood, businessType, strategy, foundCompanies || 0);

      return res.status(200).json({
        success: true,
        learning: learning
      });
    }

    return res.status(400).json({ error: 'Ação inválida' });

  } catch (error) {
    console.error('❌ Erro na análise:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}