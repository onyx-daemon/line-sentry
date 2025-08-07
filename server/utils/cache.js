const NodeCache = require('node-cache');

// Create cache instances with different TTL values
const departmentCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const userCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const moldCache = new NodeCache({ stdTTL: 300 }); // 5 minutes
const configCache = new NodeCache({ stdTTL: 600 }); // 10 minutes
const machineStatsCache = new NodeCache({ stdTTL: 60 }); // 1 minute for stats

class CacheManager {
  // Department cache methods
  getDepartments() {
    return departmentCache.get('all_departments');
  }

  setDepartments(departments) {
    departmentCache.set('all_departments', departments);
  }

  invalidateDepartments() {
    departmentCache.del('all_departments');
  }

  // User cache methods
  getUsers() {
    return userCache.get('all_users');
  }

  setUsers(users) {
    userCache.set('all_users', users);
  }

  invalidateUsers() {
    userCache.del('all_users');
  }

  // Mold cache methods
  getMolds() {
    return moldCache.get('all_molds');
  }

  setMolds(molds) {
    moldCache.set('all_molds', molds);
  }

  invalidateMolds() {
    moldCache.del('all_molds');
  }

  // Config cache methods
  getConfig() {
    return configCache.get('system_config');
  }

  setConfig(config) {
    configCache.set('system_config', config);
  }

  invalidateConfig() {
    configCache.del('system_config');
  }

  // Machine stats cache methods
  getMachineStats(machineId, period) {
    return machineStatsCache.get(`stats_${machineId}_${period}`);
  }

  setMachineStats(machineId, period, stats) {
    machineStatsCache.set(`stats_${machineId}_${period}`, stats);
  }

  invalidateMachineStats(machineId) {
    const keys = machineStatsCache.keys();
    keys.forEach(key => {
      if (key.startsWith(`stats_${machineId}_`)) {
        machineStatsCache.del(key);
      }
    });
  }

  invalidateAllMachineStats() {
    const keys = machineStatsCache.keys();
    keys.forEach(key => {
      if (key.startsWith('stats_')) {
        machineStatsCache.del(key);
      }
    });
  }

  // Clear all caches
  clearAll() {
    departmentCache.flushAll();
    userCache.flushAll();
    moldCache.flushAll();
    configCache.flushAll();
    machineStatsCache.flushAll();
  }
}

module.exports = new CacheManager();