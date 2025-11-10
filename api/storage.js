import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for Vercel serverless functions
const DATA_DIR = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', 'data');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');
const LEARNING_FILE = path.join(DATA_DIR, 'learning.json');
const CACHE_FILE = path.join(DATA_DIR, 'cache.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
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

// Storage utility functions
export const storage = {
  // Companies storage with indexing
  _companiesIndex: new Map(), // In-memory index for faster lookups
  _companiesLastLoad: 0,

  async getCompanies() {
    try {
      const data = fs.readFileSync(COMPANIES_FILE, 'utf8');
      const companies = JSON.parse(data);

      // Build index if not exists or file changed
      const stats = fs.statSync(COMPANIES_FILE);
      if (this._companiesLastLoad < stats.mtime.getTime()) {
        this._companiesIndex.clear();
        Object.entries(companies).forEach(([key, company]) => {
          this._companiesIndex.set(key, company);
          // Index by searchTerm for faster filtering
          if (company.searchTerm) {
            if (!this._companiesIndex.has(`searchTerm:${company.searchTerm}`)) {
              this._companiesIndex.set(`searchTerm:${company.searchTerm}`, []);
            }
            this._companiesIndex.get(`searchTerm:${company.searchTerm}`).push(key);
          }
        });
        this._companiesLastLoad = stats.mtime.getTime();
      }

      return companies;
    } catch (error) {
      console.error('Error reading companies:', error);
      return {};
    }
  },

  async saveCompany(key, data) {
    try {
      const companies = await this.getCompanies();
      companies[key] = { ...data, savedAt: Date.now() };
      fs.writeFileSync(COMPANIES_FILE, JSON.stringify(companies, null, 2));

      // Update index
      this._companiesIndex.set(key, companies[key]);
      if (data.searchTerm) {
        if (!this._companiesIndex.has(`searchTerm:${data.searchTerm}`)) {
          this._companiesIndex.set(`searchTerm:${data.searchTerm}`, []);
        }
        const termIndex = this._companiesIndex.get(`searchTerm:${data.searchTerm}`);
        if (!termIndex.includes(key)) {
          termIndex.push(key);
        }
      }

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

  // Optimized search by term using index
  async getCompaniesBySearchTerm(searchTerm) {
    try {
      await this.getCompanies(); // Ensure index is built
      const companyKeys = this._companiesIndex.get(`searchTerm:${searchTerm}`) || [];
      const companies = await this.getCompanies();
      return companyKeys.map(key => companies[key]).filter(Boolean);
    } catch (error) {
      console.error('Error getting companies by search term:', error);
      // Fallback to filtering all companies
      const companies = await this.getCompanies();
      return Object.values(companies).filter(company =>
        company.searchTerm === searchTerm && company.foundAt
      );
    }
  },

  // Stats storage
  async getStats() {
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
  },

  async updateStats(updates) {
    try {
      const stats = await this.getStats();
      Object.assign(stats, updates);
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
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
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
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
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
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
      fs.writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
      return true;
    } catch (error) {
      console.error('Error incrementing business hits:', error);
      return false;
    }
  },

  // Learning data storage
  async getLearningData() {
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
  },

  async saveLearningData(data) {
    try {
      fs.writeFileSync(LEARNING_FILE, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      console.error('Error saving learning data:', error);
      return false;
    }
  },

  // ==================== CACHE SYSTEM ====================
  async getCache() {
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
  },

  async saveCache(data) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
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
  }
};