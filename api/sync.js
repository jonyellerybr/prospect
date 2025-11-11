import { storage } from './storage.js';

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, data } = req.body;

        switch (action) {
            case 'sync_to_cloud':
                // Sincronizar dados locais para a nuvem
                return await syncToCloud(data, res);

            case 'sync_from_cloud':
                // Sincronizar dados da nuvem para local
                return await syncFromCloud(res);

            case 'merge_data':
                // Mesclar dados locais e da nuvem
                return await mergeData(data, res);

            default:
                return res.status(400).json({
                    success: false,
                    error: 'Ação não suportada. Use: sync_to_cloud, sync_from_cloud, ou merge_data'
                });
        }

    } catch (error) {
        console.error('❌ Erro na sincronização:', error);
        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}

async function syncToCloud(localData, res) {
    try {
        console.log('🔄 Sincronizando dados locais para a nuvem...');

        let syncedCount = 0;

        // Sincronizar empresas
        if (localData.companies && Array.isArray(localData.companies)) {
            for (const company of localData.companies) {
                if (company.foundAt) {
                    // É uma empresa
                    const key = `company:${Buffer.from(company.url).toString('base64').substring(0, 50)}`;
                    await storage.saveCompany(key, company);
                    syncedCount++;
                } else if (company.completedAt) {
                    // É uma busca
                    const key = `search:${Buffer.from(company.searchTerm).toString('base64')}`;
                    await storage.saveCompany(key, company);
                }
            }
        }

        // Sincronizar estatísticas se fornecidas
        if (localData.stats) {
            await storage.updateStats(localData.stats);
        }

        // Sincronizar dados de aprendizado se fornecidos
        if (localData.learning) {
            await storage.saveLearningData(localData.learning);
        }

        console.log(`✅ ${syncedCount} itens sincronizados para a nuvem`);

        return res.status(200).json({
            success: true,
            message: `${syncedCount} itens sincronizados para a nuvem`,
            syncedCount
        });

    } catch (error) {
        console.error('Erro ao sincronizar para nuvem:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro ao sincronizar para nuvem: ' + error.message
        });
    }
}

async function syncFromCloud(res) {
    try {
        console.log('🔄 Baixando dados da nuvem...');

        // Buscar todas as empresas da nuvem
        const allCompanies = await storage.getAllCompanies();

        // Buscar estatísticas
        const stats = await storage.getStats();

        // Buscar dados de aprendizado
        const learning = await storage.getLearningData();

        const cloudData = {
            companies: allCompanies,
            stats: stats,
            learning: learning,
            lastSync: Date.now()
        };

        console.log(`✅ ${allCompanies.length} itens baixados da nuvem`);

        return res.status(200).json({
            success: true,
            message: `${allCompanies.length} itens baixados da nuvem`,
            data: cloudData
        });

    } catch (error) {
        console.error('Erro ao baixar da nuvem:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro ao baixar da nuvem: ' + error.message
        });
    }
}

async function mergeData(localData, res) {
    try {
        console.log('🔄 Mesclando dados locais e da nuvem...');

        // Buscar dados atuais da nuvem
        const cloudCompanies = await storage.getAllCompanies();
        const cloudStats = await storage.getStats();
        const cloudLearning = await storage.getLearningData();

        // Criar mapas para facilitar a mesclagem
        const cloudCompaniesMap = new Map();
        cloudCompanies.forEach(company => {
            const key = company.foundAt ? company.url : company.searchTerm;
            cloudCompaniesMap.set(key, company);
        });

        let mergedCount = 0;
        let updatedCount = 0;

        // Mesclar empresas
        if (localData.companies && Array.isArray(localData.companies)) {
            for (const localCompany of localData.companies) {
                const key = localCompany.foundAt ? localCompany.url : localCompany.searchTerm;
                const cloudCompany = cloudCompaniesMap.get(key);

                if (!cloudCompany) {
                    // Empresa não existe na nuvem, adicionar
                    if (localCompany.foundAt) {
                        const storageKey = `company:${Buffer.from(localCompany.url).toString('base64').substring(0, 50)}`;
                        await storage.saveCompany(storageKey, localCompany);
                    } else {
                        const storageKey = `search:${Buffer.from(localCompany.searchTerm).toString('base64')}`;
                        await storage.saveCompany(storageKey, localCompany);
                    }
                    mergedCount++;
                } else if ((localCompany.foundAt || 0) > (cloudCompany.foundAt || 0)) {
                    // Versão local é mais recente, atualizar
                    if (localCompany.foundAt) {
                        const storageKey = `company:${Buffer.from(localCompany.url).toString('base64').substring(0, 50)}`;
                        await storage.saveCompany(storageKey, localCompany);
                    } else {
                        const storageKey = `search:${Buffer.from(localCompany.searchTerm).toString('base64')}`;
                        await storage.saveCompany(storageKey, localCompany);
                    }
                    updatedCount++;
                }
            }
        }

        // Mesclar estatísticas (manter a mais recente)
        if (localData.stats) {
            const mergedStats = { ...cloudStats };
            Object.keys(localData.stats).forEach(key => {
                if (typeof localData.stats[key] === 'number' &&
                    (!mergedStats[key] || localData.stats[key] > mergedStats[key])) {
                    mergedStats[key] = localData.stats[key];
                }
            });
            await storage.updateStats(mergedStats);
        }

        // Mesclar dados de aprendizado
        if (localData.learning) {
            const mergedLearning = { ...cloudLearning };

            // Mesclar arrays únicos
            ['successfulSearches', 'failedSearches'].forEach(arrayKey => {
                if (localData.learning[arrayKey]) {
                    const combined = [
                        ...(mergedLearning[arrayKey] || []),
                        ...localData.learning[arrayKey]
                    ];
                    // Remover duplicatas
                    mergedLearning[arrayKey] = [...new Set(combined)];
                }
            });

            // Manter valores numéricos mais altos
            ['totalSearches', 'successRate'].forEach(numKey => {
                if (localData.learning[numKey] && localData.learning[numKey] > (mergedLearning[numKey] || 0)) {
                    mergedLearning[numKey] = localData.learning[numKey];
                }
            });

            await storage.saveLearningData(mergedLearning);
        }

        console.log(`✅ Mesclagem concluída: ${mergedCount} novos, ${updatedCount} atualizados`);

        return res.status(200).json({
            success: true,
            message: `Mesclagem concluída: ${mergedCount} novos, ${updatedCount} atualizados`,
            mergedCount,
            updatedCount
        });

    } catch (error) {
        console.error('Erro na mesclagem:', error);
        return res.status(500).json({
            success: false,
            error: 'Erro na mesclagem: ' + error.message
        });
    }
}