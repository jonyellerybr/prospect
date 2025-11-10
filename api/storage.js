import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, '..', 'data');
const COMPANIES_FILE = path.join(DATA_DIR, 'companies.json');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

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

// Storage utility functions
export const storage = {
  // Companies storage
  async getCompanies() {
    try {
      const data = fs.readFileSync(COMPANIES_FILE, 'utf8');
      return JSON.parse(data);
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
  }
};