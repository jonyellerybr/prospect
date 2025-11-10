import { GoogleGenerativeAI } from '@google/generative-ai';
import { Mistral } from '@mistralai/mistralai';
import dotenv from 'dotenv';

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
    this.genAI = null;
    this.model = null;
    this.initialize();
  }

  initialize() {
    const apiKey = getNextGeminiKey();
    if (apiKey) {
      this.genAI = new GoogleGenerativeAI(apiKey);
      this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    }
  }

  async generateContent(prompt) {
    try {
      if (!this.model) {
        throw new Error('Gemini model not initialized');
      }

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      console.error('Gemini API error:', error);
      // Tentar com próxima chave se disponível
      if (GEMINI_KEYS.length > 1) {
        this.initialize();
        return this.generateContent(prompt);
      }
      throw error;
    }
  }
}

// Classe para integração com Mistral
class MistralService {
  constructor() {
    this.client = null;
    this.initialize();
  }

  initialize() {
    const apiKey = getNextMistralKey();
    if (apiKey) {
      this.client = new Mistral({ apiKey });
    }
  }

  async generateContent(prompt) {
    try {
      if (!this.client) {
        throw new Error('Mistral client not initialized');
      }

      const response = await this.client.chat({
        model: 'mistral-medium',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
        temperature: 0.7
      });

      return response.choices[0].message.content;
    } catch (error) {
      console.error('Mistral API error:', error);
      // Tentar com próxima chave se disponível
      if (MISTRAL_KEYS.length > 1) {
        this.initialize();
        return this.generateContent(prompt);
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
  const prompt = `Analise esta empresa e forneça informações úteis para prospecção comercial:

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
        timestamp: Date.now()
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
        timestamp: Date.now()
      };
    }
  } catch (error) {
    console.error('Mistral also failed:', error.message);
  }

  // Fallback básico se ambas falharem
  return {
    provider: 'fallback',
    analysis: `Empresa: ${companyData.title}\nTipo: ${companyData.businessType}\nBairro: ${companyData.neighborhood}\nPotencial: Médio`,
    timestamp: Date.now()
  };
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