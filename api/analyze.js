import { storage } from './storage.js';
import { analyzeCompany, generateProspectingReport } from './ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, companyId, limit = 10 } = req.body;

    if (action === 'analyze_company' && companyId) {
      // Buscar empresa específica
      const company = await storage.getCompany(companyId);

      if (!company) {
        return res.status(404).json({ error: 'Empresa não encontrada' });
      }

      // Analisar empresa com IA
      const analysis = await analyzeCompany(company);

      // Salvar análise
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

    return res.status(400).json({ error: 'Ação inválida' });

  } catch (error) {
    console.error('❌ Erro na análise:', error);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}