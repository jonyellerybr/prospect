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