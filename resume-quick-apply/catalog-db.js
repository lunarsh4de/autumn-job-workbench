// IndexedDB keeps large public job catalogs local without localStorage size limits.
(() => {
  const DB_NAME = 'autumn-job-workbench';
  const STORE = 'catalog';

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('company', 'company');
        store.createIndex('platform', 'platform');
        store.createIndex('jobType', 'jobType');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地岗位库。'));
    });
  }

  async function transaction(mode, work) {
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = database.transaction(STORE, mode);
        const result = work(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error || new Error('本地岗位库写入失败。'));
        tx.onabort = () => reject(tx.error || new Error('本地岗位库操作已取消。'));
      });
    } finally { database.close(); }
  }

  async function getAll() {
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('无法读取本地岗位库。'));
      });
    } finally { database.close(); }
  }

  function putMany(items) {
    return transaction('readwrite', store => { for (const item of items) store.put(item); });
  }

  function replaceAll(items) {
    return transaction('readwrite', store => {
      store.clear();
      for (const item of items) store.put(item);
    });
  }

  function clear() { return transaction('readwrite', store => store.clear()); }

  const api = { getAll, putMany, replaceAll, clear };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else globalThis.CatalogDB = api;
})();
