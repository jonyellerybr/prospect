import { GoogleGenerativeAI } from '@google/generative-ai';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';
import { storage } from './storage.js';

dotenv.config();

const GEMINI_KEYS = (process.env.GEMINI_KEYS || '').split(',').filter(key => key.trim());
const MISTRAL_KEYS = (process.env.MISTRAL_KEYS || '').split(',').filter(key => key.trim());

let currentGeminiIndex = 0;
let currentMistralIndex = 0;

// Função para obter próxima chave Gemini
function getNextGeminiKey() {
  if (GEMINI_KEYS.length === 0) return null;
  const key = GEMINI_KEYS[currentGeminiIndex].trim();
  currentGeminiIndex = (currentGeminiIndex + 1) % GEMINI_KEYS.length;
  return key;
}

// Função para obter próxima chave Mistral
function getNextMistralKey() {
  if (MISTRAL_KEYS.length === 0) return null;
  const key = MISTRAL_KEYS[currentMistralIndex].trim();
  currentMistralIndex = (currentMistralIndex + 1) % MISTRAL_KEYS.length;
  return key;
}

// Classe para integração com Gemini
class GeminiService {
  constructor() {
    this.apiKey = null;
    this.initialize();
  }

  initialize() {
    this.apiKey = getNextGeminiKey();
  }

  async generateContent(prompt, timeout = 20000) {
    try {
      if (!this.apiKey) {
        throw new Error('Gemini API key not available');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${this.apiKey}`,
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

      if (!response.ok) {
        if (response.status === 429 || response.status === 401) {
          // Tentar com próxima chave
          if (GEMINI_KEYS.length > 1) {
            this.initialize();
            return this.generateContent(prompt, timeout);
          }
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (text) return text;

      throw new Error('Empty response from Gemini');
    } catch (error) {
      console.error('Gemini API error:', error);
      // Tentar com próxima chave se disponível
      if (GEMINI_KEYS.length > 1) {
        this.initialize();
        return this.generateContent(prompt, timeout);
      }
      throw error;
    }
  }
}

// Classe para integração com Mistral
class MistralService {
  constructor() {
    this.apiKey = null;
    this.initialize();
  }

  initialize() {
    this.apiKey = getNextMistralKey();
  }

  async generateContent(prompt, timeout = 20000) {
    try {
      if (!this.apiKey) {
        throw new Error('Mistral API key not available');
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(
        'https://api.mistral.ai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            model: 'mistral-large-latest',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 2048,
            temperature: 0.7
          }),
          signal: controller.signal
        }
      );

      clearTimeout(timer);

      if (!response.ok) {
        if (response.status === 429 || response.status === 401) {
          // Tentar com próxima chave
          if (MISTRAL_KEYS.length > 1) {
            this.initialize();
            return this.generateContent(prompt, timeout);
          }
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const result = await response.json();
      const text = result?.choices?.[0]?.message?.content?.trim();
      if (text) return text;

      throw new Error('Empty response from Mistral');
    } catch (error) {
      console.error('Mistral API error:', error);
      // Tentar com próxima chave se disponível
      if (MISTRAL_KEYS.length > 1) {
        this.initialize();
        return this.generateContent(prompt, timeout);
      }
      throw error;
    }
  }
}

// Instâncias dos serviços
const geminiService = new GeminiService();
const mistralService = new MistralService();

// Função principal para análise de empresas
export async function analyzeCompany(companyData) {
  // Usar prompt customizado se fornecido (para validação)
  const prompt = companyData.customPrompt || `Analise esta empresa e forneça informações úteis para prospecção comercial:

Empresa: ${companyData.title}
Descrição: ${companyData.description}
URL: ${companyData.url}
Bairro: ${companyData.neighborhood}
Tipo de negócio: ${companyData.businessType}
Termo de busca: ${companyData.searchTerm}

Forneça uma análise concisa incluindo:
1. Tipo de empresa e segmento
2. Potencial comercial
3. Informações de contato se disponíveis na descrição
4. Recomendações para abordagem comercial

Responda em português brasileiro.`;

  try {
    // Tentar primeiro com Gemini
    if (geminiService.model) {
      const analysis = await geminiService.generateContent(prompt);
      return {
        provider: 'gemini',
        analysis: analysis,
        timestamp: Date.now(),
        prediction: await generateConversionPrediction(companyData)
      };
    }
  } catch (error) {
    console.warn('Gemini failed, trying Mistral:', error.message);
  }

  try {
    // Fallback para Mistral
    if (mistralService.client) {
      const analysis = await mistralService.generateContent(prompt);
      return {
        provider: 'mistral',
        analysis: analysis,
        timestamp: Date.now(),
        prediction: await generateConversionPrediction(companyData)
      };
    }
  } catch (error) {
    console.error('Mistral also failed:', error.message);
  }

  // Fallback básico se ambas falharem
  return {
    provider: 'fallback',
    analysis: `Empresa: ${companyData.title}\nTipo: ${companyData.businessType}\nBairro: ${companyData.neighborhood}\nPotencial: Médio`,
    timestamp: Date.now(),
    prediction: { score: 50, factors: ['fallback_used'] }
  };
}

// ==================== SISTEMA DE PREDIÇÃO ====================
export async function generateConversionPrediction(companyData) {
  try {
    // Fatores de predição baseados em dados históricos
    const factors = [];
    let score = 50; // Score base

    // Fator 1: Tipo de negócio (baseado em dados de aprendizado)
    const learning = await loadLearningData();
    const businessScore = learning.bestBusinessTypes[companyData.businessType] || 0;
    if (businessScore > 10) {
      score += 15;
      factors.push('business_type_high_performance');
    } else if (businessScore > 5) {
      score += 5;
      factors.push('business_type_medium_performance');
    }

    // Fator 2: Bairro (baseado em dados de aprendizado)
    const neighborhoodScore = learning.bestNeighborhoods[companyData.neighborhood] || 0;
    if (neighborhoodScore > 15) {
      score += 20;
      factors.push('neighborhood_high_performance');
    } else if (neighborhoodScore > 8) {
      score += 10;
      factors.push('neighborhood_medium_performance');
    }

    // Fator 3: Presença de contato na descrição
    if (companyData.description && (
      companyData.description.includes('telefone') ||
      companyData.description.includes('contato') ||
      companyData.description.includes('whatsapp') ||
      companyData.description.includes('@')
    )) {
      score += 10;
      factors.push('contact_info_available');
    }

    // Fator 4: Redes sociais (bom sinal para empresas modernas)
    if (companyData.url && (
      companyData.url.includes('instagram') ||
      companyData.url.includes('facebook') ||
      companyData.url.includes('linkedin')
    )) {
      score += 8;
      factors.push('social_media_presence');
    }

    // Fator 5: Site profissional
    if (companyData.url && !companyData.url.includes('instagram') && !companyData.url.includes('facebook')) {
      score += 12;
      factors.push('professional_website');
    }

    // Fator 6: Tamanho do título (empresas com nomes mais descritivos tendem a ser mais estabelecidas)
    if (companyData.title && companyData.title.length > 20) {
      score += 5;
      factors.push('descriptive_business_name');
    }

    // Limitar score entre 0 e 100
    score = Math.max(0, Math.min(100, score));

    // Categorizar score
    let category;
    if (score >= 80) category = 'excelente';
    else if (score >= 65) category = 'bom';
    else if (score >= 45) category = 'médio';
    else category = 'baixo';

    return {
      score: Math.round(score),
      category,
      factors,
      confidence: 75, // Confiança do modelo
      recommendation: getRecommendationForScore(score, companyData.businessType)
    };

  } catch (error) {
    console.error('Erro na predição:', error);
    return {
      score: 50,
      category: 'médio',
      factors: ['error_occurred'],
      confidence: 0,
      recommendation: 'Avaliação manual necessária'
    };
  }
}

function getRecommendationForScore(score, businessType) {
  if (score >= 80) {
    return `Excelente oportunidade! ${businessType} com alto potencial. Priorize contato imediato.`;
  } else if (score >= 65) {
    return `Boa oportunidade. ${businessType} com bom histórico. Contate nos próximos dias.`;
  } else if (score >= 45) {
    return `Oportunidade média. ${businessType} com potencial moderado. Considere abordagem personalizada.`;
  } else {
    return `Oportunidade limitada. ${businessType} com baixo histórico. Foque em outras leads primeiro.`;
  }
}

// Função para análise de sentimento da descrição
export async function analyzeSentiment(text) {
  try {
    const prompt = `Analise o sentimento desta descrição de empresa e classifique como POSITIVO, NEUTRO ou NEGATIVO. Considere fatores como profissionalismo, confiança e atratividade para clientes.

Texto: "${text}"

Responda apenas com: POSITIVO/NEUTRO/NEGATIVO - breve justificativa`;

    try {
      const result = await geminiService.generateContent(prompt);
      return {
        sentiment: result.split(' - ')[0].trim(),
        reason: result.split(' - ')[1]?.trim() || 'Análise realizada',
        confidence: 80
      };
    } catch (error) {
      console.warn('Gemini failed for sentiment analysis:', error.message);
    }

    return { sentiment: 'NEUTRO', reason: 'Análise não disponível', confidence: 0 };

  } catch (error) {
    console.error('Erro na análise de sentimento:', error);
    return { sentiment: 'NEUTRO', reason: 'Erro na análise', confidence: 0 };
  }
}

// Função para gerar recomendações de abordagem
export async function generateApproachRecommendations(companyData, prediction) {
  try {
    const prompt = `Com base nestes dados, gere 3 recomendações específicas de abordagem para esta empresa:

Empresa: ${companyData.title}
Tipo: ${companyData.businessType}
Bairro: ${companyData.neighborhood}
Score de conversão: ${prediction.score}/100 (${prediction.category})
Fatores positivos: ${prediction.factors.join(', ')}

Forneça 3 recomendações práticas e específicas para abordagem comercial.`;

    try {
      const recommendations = await geminiService.generateContent(prompt);
      return {
        recommendations: recommendations.split('\n').filter(r => r.trim().length > 0),
        generated: true
      };
    } catch (error) {
      console.warn('Gemini failed for approach recommendations:', error.message);
    }

    return {
      recommendations: [
        'Entre em contato por telefone durante horário comercial',
        'Envie proposta personalizada por email',
        'Agende visita presencial para apresentação'
      ],
      generated: false
    };

  } catch (error) {
    console.error('Erro gerando recomendações:', error);
    return {
      recommendations: ['Abordagem padrão recomendada'],
      generated: false
    };
  }
}

// Função para gerar relatório de prospecção
export async function generateProspectingReport(companies) {
  const prompt = `Com base nestas empresas encontradas, gere um relatório de prospecção comercial:

${companies.map((c, i) => `${i+1}. ${c.title} - ${c.businessType} (${c.neighborhood})`).join('\n')}

Forneça:
1. Resumo geral do mercado
2. Segmentos mais promissores
3. Estratégias de abordagem recomendadas
4. Próximos passos para prospecção

Responda em português brasileiro.`;

  try {
    if (geminiService.model) {
      const report = await geminiService.generateContent(prompt);
      return {
        provider: 'gemini',
        report: report,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.warn('Gemini failed for report, trying Mistral:', error.message);
  }

  try {
    if (mistralService.client) {
      const report = await mistralService.generateContent(prompt);
      return {
        provider: 'mistral',
        report: report,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('Mistral also failed for report:', error.message);
  }

  return {
    provider: 'fallback',
    report: 'Relatório não disponível - erro nas APIs de IA',
    timestamp: Date.now()
  };
}

// ==================== SISTEMA DE APRENDIZADO ====================
export async function loadLearningData() {
  try {
    const data = await storage.getLearningData();
    return data || {
      successfulSearches: [],
      failedSearches: [],
      bestNeighborhoods: {},
      bestBusinessTypes: {},
      bestStrategies: {},
      totalSearches: 0,
      successRate: 0
    };
  } catch (error) {
    console.error('Erro ao carregar dados de aprendizado:', error);
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
}

export async function saveLearningData(data) {
  try {
    await storage.saveLearningData(data);
  } catch (error) {
    console.error('Erro ao salvar dados de aprendizado:', error);
  }
}

export async function updateLearning(searchTerm, neighborhood, businessType, strategy, foundCompanies) {
  const learning = await loadLearningData();

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
  await saveLearningData(learning);
  return learning;
}

// ==================== GERADOR INTELIGENTE DE TERMOS ====================
export async function generateSmartSearchTerms(maxTerms = 30) {
  const learning = await loadLearningData();
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

  // Bairros de Fortaleza
  const FORTALEZA_NEIGHBORHOODS = [
    "Aldeota", "Meireles", "Mucuripe", "Varjota", "Papicu", "Praia de Iracema",
    "Cocó", "Luciano Cavalcante", "Dionísio Torres", "Joaquim Távora",
    "Centro", "Benfica", "Fátima", "Parquelândia", "Rodolfo Teófilo",
    "Messejana", "Cambeba", "Cidade dos Funcionários", "Edson Queiroz",
    "Passaré", "Lagoa Redonda", "Sapiranga", "José de Alencar",
    "Parangaba", "Montese", "Maraponga", "Antônio Bezerra", "Bom Jardim",
    "Cajazeiras", "Vila Pery", "Serrinha", "Mondubim", "Itaperi",
    "Dunas", "Salinas", "Sabiaguaba", "Água Fria", "Jangurussu",
    "Ancuri", "Pedras", "Guajeru", "Coaçu"
  ];

  // Tipos de negócio
  const BUSINESS_TYPES = [
    "restaurante", "lanchonete", "pizzaria", "hamburgueria", "açaiteria",
    "padaria", "cafeteria", "bar", "petiscos", "delivery",
    "advogado", "escritório advocacia", "dentista", "clínica odontológica",
    "médico", "clínica médica", "psicólogo", "nutricionista",
    "salão beleza", "barbearia", "estética", "manicure", "depilação",
    "clínica estética", "spa",
    "academia", "personal trainer", "crossfit", "pilates", "yoga",
    "fisioterapia", "quiropraxia",
    "pet shop", "veterinário", "banho e tosa", "hotel para pets",
    "mecânica", "auto center", "lava jato", "auto elétrica", "borracharia",
    "loja roupas", "boutique", "moda feminina", "moda masculina",
    "calçados", "acessórios", "joalheria",
    "farmácia", "drogaria", "manipulação",
    "construtora", "engenharia", "reformas", "pinturas", "marcenaria",
    "vidraçaria", "serralheria",
    "contabilidade", "consultoria", "imobiliária", "corretor imóveis",
    "despachante", "advocacia empresarial",
    "escola", "curso", "reforço escolar", "idiomas", "pré-vestibular",
    "assistência técnica", "informática", "eletrônica",
    "fotografia", "decoração", "design interiores", "móveis planejados",
    "floricultura", "chaveiro", "lavanderia"
  ];

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

  console.log(`📊 SISTEMA DE APRENDIZADO ATIVO`);
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

// ==================== ANÁLISE PROFUNDA DE EMPRESA ====================
export async function analyzeCompanyDeep(companyData) {
  const prompt = `Você é especialista em análise de websites para vendas consultivas.

🎯 MEUS SERVIÇOS:
- Criação de Sites Profissionais
- Landing Pages de Alta Conversão
- Gestão de Tráfego Pago (Google Ads, Meta Ads)
- SEO e Otimização para Google
- Automação de WhatsApp e Chatbots
- Identidade Visual e Branding
- Consultoria em Marketing Digital

📊 DADOS DA EMPRESA:
URL: ${companyData.url}
Título: ${companyData.title}
Descrição: ${companyData.description}
Bairro: ${companyData.neighborhood}
Tipo de negócio: ${companyData.businessType}
Termo de busca: ${companyData.searchTerm}

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

  try {
    // Tentar primeiro com Gemini
    if (geminiService.model) {
      const analysis = await geminiService.generateContent(prompt);
      return {
        provider: 'gemini',
        analysis: analysis,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.warn('Gemini failed for deep analysis, trying Mistral:', error.message);
  }

  try {
    // Fallback para Mistral
    if (mistralService.client) {
      const analysis = await mistralService.generateContent(prompt);
      return {
        provider: 'mistral',
        analysis: analysis,
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('Mistral also failed for deep analysis:', error.message);
  }

  // Fallback básico se ambas falharem
  return {
    provider: 'fallback',
    analysis: `🏢 PERFIL: ${companyData.businessType} em ${companyData.neighborhood}

💎 OPORTUNIDADES:
🎯 SERVIÇO: Criação de Sites Profissionais
📊 PRIORIDADE: 🟡
❌ PROBLEMA: Possível ausência de presença digital
💡 SOLUÇÃO: Desenvolver website profissional

🎤 PITCH: Olá! Vi que vocês são ${companyData.businessType} em ${companyData.neighborhood}. Gostaria de conversar sobre como podemos ajudar seu negócio com soluções digitais?

💰 POTENCIAL: MÉDIO - Empresa local com necessidade de presença online`,
    timestamp: Date.now()
  };
}