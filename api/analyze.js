import { storage } from './storage.js';
import { analyzeCompany, generateProspectingReport, analyzeCompanyDeep, updateLearning, generateSmartSearchTerms, analyzeSentiment, generateApproachRecommendations } from './ai.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { action, companyId, limit = 10 } = req.body;

    if (action === 'analyze_company' && companyId) {
      // Record analytics
      await storage.recordUserAction('ai_analysis_requested', { companyId });

      // Verificar cache primeiro
      const cachedAnalysis = await storage.getCachedCompanyAnalysis(companyId);
      if (cachedAnalysis) {
        console.log(`⚡ Análise em cache encontrada para empresa: ${companyId}`);
        await storage.recordUserAction('ai_analysis_cache_hit', { companyId });
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

      // Record analysis start
      const analysisStartTime = Date.now();

      // Analisar empresa com IA
      const analysis = await analyzeCompany(company);

      // Record performance
      const analysisDuration = Date.now() - analysisStartTime;
      await storage.updatePerformanceMetric('ai_analysis_duration', analysisDuration);
      await storage.recordUserAction('ai_analysis_completed', {
        companyId,
        duration: analysisDuration,
        provider: analysis.provider
      });

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
      console.log('Ação recebida: analyze_company_deep, companyId:', companyId);
      // Verificar cache primeiro
      const cachedAnalysis = await storage.getCachedCompanyAnalysis(`${companyId}_deep`);
      if (cachedAnalysis) {
        console.log(`⚡ Análise profunda em cache encontrada para empresa: ${companyId}`);
        await storage.recordUserAction('deep_analysis_cache_hit', { companyId });
        return res.status(200).json({
          success: true,
          analysis: cachedAnalysis,
          cached: true
        });
      }

      // Buscar empresa específica
      console.log('Buscando empresa com ID:', companyId);
      let company = await storage.getCompany(companyId);
      console.log('Empresa encontrada diretamente:', company ? 'SIM' : 'NÃO');

      if (!company) {
        console.log('Empresa não encontrada no storage. Tentando buscar por URL...');

        // Tentar encontrar empresa por URL (caso o ID não corresponda)
        const allCompanies = await storage.getAllCompanies();
        console.log('Total de empresas no storage:', allCompanies.length);

        // Procurar empresa que tenha URL similar
        let foundCompany = null;
        let decodedUrl = null;

        try {
          decodedUrl = atob(companyId);
          console.log('URL decodificada:', decodedUrl);

          for (const comp of allCompanies) {
            if (comp.url && comp.url.includes(decodedUrl)) {
              foundCompany = comp;
              console.log('Empresa encontrada por URL:', comp.title);
              break;
            }
          }
        } catch (decodeError) {
          console.log('Erro ao decodificar companyId:', decodeError.message);
        }

        if (!foundCompany) {
          console.log('Empresa ainda não encontrada. Tentando busca mais ampla...');

          // Tentar busca mais ampla - procurar por qualquer parte da URL
          for (const comp of allCompanies) {
            if (comp.url && decodedUrl) {
              // Tentar match exato primeiro
              if (comp.url === decodedUrl) {
                foundCompany = comp;
                console.log('Empresa encontrada por URL exata:', comp.title);
                break;
              }
              // Depois tentar substring
              if (comp.url.includes(decodedUrl.substring(0, 30))) {
                foundCompany = comp;
                console.log('Empresa encontrada por substring da URL:', comp.title);
                break;
              }
            }
          }

          if (!foundCompany) {
            console.log('Empresa definitivamente não encontrada. Listando primeiras empresas:');
            console.log('Primeiras 5 empresas:', allCompanies.slice(0, 5).map(c => ({ title: c.title, url: c.url?.substring(0, 50) })));
            return res.status(404).json({ error: 'Empresa não encontrada. Tente recarregar a página.' });
          }
        }

        // Usar empresa encontrada
        company = foundCompany;
      }

      // Record analytics
      await storage.recordUserAction('deep_analysis_requested', { companyId });
      const analysisStartTime = Date.now();

      // Análise profunda com IA
      console.log('Iniciando análise profunda para empresa:', company.title);
      const analysis = await analyzeCompanyDeep(company);
      console.log('Análise profunda concluída');

      // Análise de sentimento
      console.log('Analisando sentimento...');
      const sentiment = await analyzeSentiment(company.description || company.title);

      // Recomendações de abordagem
      console.log('Gerando predição de conversão...');
      const prediction = await generateConversionPrediction(company);
      console.log('Gerando recomendações de abordagem...');
      const approachRecs = await generateApproachRecommendations(company, prediction);

      // Combinar análises
      const enhancedAnalysis = {
        ...analysis,
        sentiment,
        prediction,
        approachRecommendations: approachRecs,
        analysisDate: new Date().toISOString()
      };

      console.log('Análise completa gerada com sucesso');

      // Record performance
      const analysisDuration = Date.now() - analysisStartTime;
      await storage.updatePerformanceMetric('deep_analysis_duration', analysisDuration);
      await storage.recordUserAction('deep_analysis_completed', {
        companyId,
        duration: analysisDuration,
        predictionScore: prediction.score
      });

      // Salvar análise no cache
      await storage.setCachedCompanyAnalysis(`${companyId}_deep`, enhancedAnalysis);

      // Salvar análise profunda na empresa
      company.deepAnalysis = enhancedAnalysis;
      await storage.saveCompany(companyId, company);

      console.log('Enviando resposta da análise');
      return res.status(200).json({
        success: true,
        analysis: enhancedAnalysis
      });
    }

    if (action === 'generate_smart_terms') {
      const maxTerms = req.body.maxTerms || 30;

      // Record analytics
      await storage.recordUserAction('smart_terms_requested', { maxTerms });

      const startTime = Date.now();
      const searchTerms = await generateSmartSearchTerms(maxTerms);
      const duration = Date.now() - startTime;

      // Record performance
      await storage.updatePerformanceMetric('smart_terms_generation_duration', duration);
      await storage.recordUserAction('smart_terms_generated', {
        maxTerms,
        generatedTerms: searchTerms.length,
        duration
      });

      return res.status(200).json({
        success: true,
        searchTerms: searchTerms,
        totalTerms: searchTerms.length,
        generationTime: duration
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
    console.error('Stack trace:', error.stack);

    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
}