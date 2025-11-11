import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { put, head } from '@vercel/blob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Detect if running on Vercel
const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL_ENV;

// Use filesystem for local development, Blob Storage for Vercel
const USE_BLOB_STORAGE = IS_VERCEL;

// File paths/keys
const COMPANIES_KEY = 'companies.json';
const STATS_KEY = 'stats.json';
const LEARNING_KEY = 'learning.json';
const CACHE_KEY = 'cache.json';

// Local file paths (for development)
const DATA_DIR = path.join(__dirname, '..', 'data');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

// Ensure data directory exists for local development
if (!USE_BLOB_STORAGE && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize local files if they don't exist (development only)
if (!USE_BLOB_STORAGE) {
  if (!fs.existsSync(COMPANIES_FILE)) {
    fs.writeFileSync(COMPANIES_FILE, JSON.stringify({}));
  }

  if (!fs.existsSync(STATS_FILE)) {
    fs.writeFileSync(STATS_FILE, JSON.stringify({
      totalSearches: 0,
      totalResults: 0,
      neighborhoods: {},
      businesses: {}
    }));
  }

  if (!fs.existsSync(LEARNING_FILE)) {
     fs.writeFileSync(LEARNING_FILE, JSON.stringify({
       successfulSearches: [],
       failedSearches: [],
       bestNeighborhoods: {},
       bestBusinessTypes: {},
       bestStrategies: {},
       totalSearches: 0,
       successRate: 0
     }));
  }

  if (!fs.existsSync(CACHE_FILE)) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({
        searchResults: {},
        companyAnalyses: {},
        reports: {},
        lastCleanup: Date.now()
      }));
  }
}

// Blob Storage helper functions
async function readBlobData(key) {
  try {
    const blob = await head(key);
    if (!blob) return null;
    const response = await fetch(blob.url);
    const text = await response.text();
    return JSON.parse(text);
  } catch (error) {
    console.error(`Error reading blob ${key}:`, error);
    return null;
  }
}

async function ensureBlobData(key, defaultData) {
  try {
    const existing = await readBlobData(key);
    if (existing !== null) return existing;

    // Create the file with default data
    await writeBlobData(key, defaultData);
    console.log(`📁 Initialized blob ${key} with default data`);
    return defaultData;
  } catch (error) {
    console.error(`Error ensuring blob ${key}:`, error);
    return defaultData;
  }
}

async function writeBlobData(key, data) {
  try {
    const blob = await put(key, JSON.stringify(data, null, 2), {
      access: 'public',
      contentType: 'application/json'
    });
    console.log(`💾 Blob saved: ${key}`);
    return true;
  } catch (error) {
    console.error(`Error writing blob ${key}:`, error);
    return false;
  }
}


// Storage utility functions
export const storage = {

  async getCompanies() {
    if (USE_BLOB_STORAGE) {
      return await ensureBlobData(COMPANIES_KEY, {});
    } else {
      try {
        const data = fs.readFileSync(COMPANIES_FILE, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error reading companies:', error);
        return {};
      }
    }
  },

  async saveCompany(key, data) {
    try {
      const companies = await this.getCompanies();
      companies[key] = { ...data, savedAt: Date.now() };

      if (USE_BLOB_STORAGE) {
        await writeBlobData(COMPANIES_KEY, companies);
      } else {
        fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2));
      }

      console.log(`💾 Empresa salva: ${key} - ${data.title || 'Sem título'}`);
      return true;
    } catch (error) {
      console.error('Error saving company:', error);
      return false;
    }
  },

  async getCompany(key) {
    try {
      const companies = await this.getCompanies();
      return companies[key] || null;
    } catch (error) {
      console.error('Error getting company:', error);
      return null;
    }
  },

  async getAllCompanies() {
    try {
      const companies = await this.getCompanies();
      return Object.values(companies);
    } catch (error) {
      console.error('Error getting all companies:', error);
      return [];
    }
  },


  // Stats storage
  async getStats() {
    if (USE_BLOB_STORAGE) {
      return await ensureBlobData(STATS_KEY, {
        totalSearches: 0,
        totalResults: 0,
        neighborhoods: {},
        businesses: {}
      });
    } else {
      try {
        const data = fs.readFileSync(STATS_FILE, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error reading stats:', error);
        return {
          totalSearches: 0,
          totalResults: 0,
          neighborhoods: {},
          businesses: {}
        };
      }
    }
  },

  async updateStats(updates) {
    try {
      const stats = await this.getStats();
      Object.assign(stats, updates);

      if (USE_BLOB_STORAGE) {
        await writeBlobData(STATS_KEY, stats);
      } else {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      }

      return true;
    } catch (error) {
      console.error('Error updating stats:', error);
      return false;
    }
  },

  async incrementStat(key, value = 1) {
    try {
      const stats = await this.getStats();
      stats[key] = (stats[key] || 0) + value;

      if (USE_BLOB_STORAGE) {
        await writeBlobData(STATS_KEY, stats);
      } else {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      }

      console.log(`📊 Estatística atualizada: ${key} = ${stats[key]}`);
      return true;
    } catch (error) {
      console.error('Error incrementing stat:', error);
      return false;
    }
  },

  async incrementNeighborhoodHits(neighborhood, hits) {
    try {
      const stats = await this.getStats();
      stats.neighborhoods[neighborhood] = (stats.neighborhoods[neighborhood] || 0) + hits;

      if (USE_BLOB_STORAGE) {
        await writeBlobData(STATS_KEY, stats);
      } else {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      }

      return true;
    } catch (error) {
      console.error('Error incrementing neighborhood hits:', error);
      return false;
    }
  },

  async incrementBusinessHits(business, hits) {
    try {
      const stats = await this.getStats();
      stats.businesses[business] = (stats.businesses[business] || 0) + hits;

      if (USE_BLOB_STORAGE) {
        await writeBlobData(STATS_KEY, stats);
      } else {
        fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      }

      return true;
    } catch (error) {
      console.error('Error incrementing business hits:', error);
      return false;
    }
  },

  // Learning data storage
  async getLearningData() {
    if (USE_BLOB_STORAGE) {
      return await ensureBlobData(LEARNING_KEY, {
        successfulSearches: [],
        failedSearches: [],
        bestNeighborhoods: {},
        bestBusinessTypes: {},
        bestStrategies: {},
        totalSearches: 0,
        successRate: 0
      });
    } else {
      try {
        const data = fs.readFileSync(LEARNING_FILE, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error reading learning data:', error);
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
  },

  async saveLearningData(data) {
    try {
      if (USE_BLOB_STORAGE) {
        await writeBlobData(LEARNING_KEY, data);
      } else {
        fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
      }
      return true;
    } catch (error) {
      console.error('Error saving learning data:', error);
      return false;
    }
  },

  // ==================== CACHE SYSTEM ====================
  async getCache() {
    if (USE_BLOB_STORAGE) {
      return await ensureBlobData(CACHE_KEY, {
        searchResults: {},
        companyAnalyses: {},
        reports: {},
        lastCleanup: Date.now()
      });
    } else {
      try {
        const data = fs.readFileSync(CACHE_FILE, 'utf8');
        return JSON.parse(data);
      } catch (error) {
        console.error('Error reading cache:', error);
        return {
          searchResults: {},
          companyAnalyses: {},
          reports: {},
          lastCleanup: Date.now()
        };
      }
    }
  },

  async saveCache(data) {
    try {
      if (USE_BLOB_STORAGE) {
        await writeBlobData(CACHE_KEY, data);
      } else {
        fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
      }
      return true;
    } catch (error) {
      console.error('Error saving cache:', error);
      return false;
    }
  },

  async getCachedSearchResult(searchTerm) {
    try {
      const cache = await this.getCache();
      const cached = cache.searchResults[searchTerm];

      if (cached && (Date.now() - cached.timestamp) < 24 * 60 * 60 * 1000) { // 24h cache
        return cached.data;
      }

      return null;
    } catch (error) {
      console.error('Error getting cached search result:', error);
      return null;
    }
  },

  async setCachedSearchResult(searchTerm, data) {
    try {
      const cache = await this.getCache();
      cache.searchResults[searchTerm] = {
        data,
        timestamp: Date.now()
      };

      // Cleanup old cache entries (keep only last 1000)
      const entries = Object.entries(cache.searchResults);
      if (entries.length > 1000) {
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        cache.searchResults = Object.fromEntries(sorted.slice(0, 1000));
      }

      await this.saveCache(cache);
      return true;
    } catch (error) {
      console.error('Error setting cached search result:', error);
      return false;
    }
  },

  async getCachedCompanyAnalysis(companyId) {
    try {
      const cache = await this.getCache();
      const cached = cache.companyAnalyses[companyId];

      if (cached && (Date.now() - cached.timestamp) < 7 * 24 * 60 * 60 * 1000) { // 7 days cache
        return cached.data;
      }

      return null;
    } catch (error) {
      console.error('Error getting cached company analysis:', error);
      return null;
    }
  },

  async setCachedCompanyAnalysis(companyId, data) {
    try {
      const cache = await this.getCache();
      cache.companyAnalyses[companyId] = {
        data,
        timestamp: Date.now()
      };

      // Cleanup old cache entries (keep only last 500)
      const entries = Object.entries(cache.companyAnalyses);
      if (entries.length > 500) {
        const sorted = entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
        cache.companyAnalyses = Object.fromEntries(sorted.slice(0, 500));
      }

      await this.saveCache(cache);
      return true;
    } catch (error) {
      console.error('Error setting cached company analysis:', error);
      return false;
    }
  },

  async cleanupExpiredCache() {
     try {
       const cache = await this.getCache();
       const now = Date.now();

       // Remove expired search results (24h)
       Object.keys(cache.searchResults).forEach(key => {
         if ((now - cache.searchResults[key].timestamp) > 24 * 60 * 60 * 1000) {
           delete cache.searchResults[key];
         }
       });

       // Remove expired company analyses (7 days)
       Object.keys(cache.companyAnalyses).forEach(key => {
         if ((now - cache.companyAnalyses[key].timestamp) > 7 * 24 * 60 * 60 * 1000) {
           delete cache.companyAnalyses[key];
         }
       });

       // Remove expired reports (1 hour)
       Object.keys(cache.reports).forEach(key => {
         if ((now - cache.reports[key].timestamp) > 60 * 60 * 1000) {
           delete cache.reports[key];
         }
       });

       cache.lastCleanup = now;
       await this.saveCache(cache);

       console.log('🧹 Cache cleanup completed');
       return true;
     } catch (error) {
       console.error('Error cleaning up cache:', error);
       return false;
     }
   },

 // User actions tracking
 async recordUserAction(action, data = {}) {
   try {
     const stats = await this.getStats();
     if (!stats.userActions) {
       stats.userActions = {};
     }
     if (!stats.userActions[action]) {
       stats.userActions[action] = { count: 0, lastAction: null };
     }
     stats.userActions[action].count++;
     stats.userActions[action].lastAction = { timestamp: Date.now(), data };

     if (USE_BLOB_STORAGE) {
       await writeBlobData(STATS_KEY, stats);
     } else {
       fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
     }

     console.log(`📊 Ação do usuário registrada: ${action}`);
     return true;
   } catch (error) {
     console.error('Error recording user action:', error);
     return false;
   }
 },

 // Performance metrics
 async updatePerformanceMetric(metric, value) {
   try {
     const stats = await this.getStats();
     if (!stats.performanceMetrics) {
       stats.performanceMetrics = {};
     }
     if (!stats.performanceMetrics[metric]) {
       stats.performanceMetrics[metric] = { total: 0, count: 0, average: 0 };
     }
     stats.performanceMetrics[metric].total += value;
     stats.performanceMetrics[metric].count++;
     stats.performanceMetrics[metric].average = stats.performanceMetrics[metric].total / stats.performanceMetrics[metric].count;

     if (USE_BLOB_STORAGE) {
       await writeBlobData(STATS_KEY, stats);
     } else {
       fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
     }

     return true;
   } catch (error) {
     console.error('Error updating performance metric:', error);
     return false;
   }
 },

};