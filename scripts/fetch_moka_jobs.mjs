import crypto from 'node:crypto';

const input = await new Promise((resolve, reject) => {
  let value = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { value += chunk; });
  process.stdin.on('end', () => resolve(value));
  process.stdin.on('error', reject);
});

const source = JSON.parse(input || '{}');
for (const key of ['url', 'org_id', 'site_id']) {
  if (!source[key]) throw new Error(`Missing Moka source field: ${key}`);
}

const pageSize = Math.min(Math.max(Number(source.page_size || 50), 1), 50);
const maxPages = Math.min(Math.max(Number(source.max_pages || 30), 1), 100);
const maxJobs = Math.min(Math.max(Number(source.max_jobs || 3000), 1), 10000);
const apiUrl = source.api_url || 'https://app.mokahr.com/api/outer/ats-apply/website/jobs/v2';
const headers = {
  accept: 'application/json',
  'content-type': 'application/json',
  'user-agent': 'autumn-job-workbench/0.15 (+public feed builder)',
};

async function fetchWithTimeout(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.status < 500 || attempt === 3) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === 3) throw error;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise(resolve => setTimeout(resolve, attempt * 750));
  }
  throw lastError;
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map(value => value.split(';', 1)[0]).join('; ');
}

const initialResponse = await fetchWithTimeout(source.url, {
  redirect: 'manual',
  headers: { 'user-agent': headers['user-agent'] },
});
const cookie = cookieHeader(initialResponse);
let landingResponse = initialResponse;
if (initialResponse.status >= 300 && initialResponse.status < 400) {
  const target = new URL(initialResponse.headers.get('location') || source.url, source.url);
  landingResponse = await fetchWithTimeout(target, {
    headers: { 'user-agent': headers['user-agent'], cookie },
  });
}
if (!landingResponse.ok) throw new Error(`Moka landing page returned HTTP ${landingResponse.status}`);
const landingHtml = (await landingResponse.text()).replaceAll('&quot;', '"');
const ivMatch = landingHtml.match(/"aesIv"\s*:\s*"([^"]+)"/);
if (!ivMatch) throw new Error('Moka landing page has no aesIv');
const aesIv = ivMatch[1];

function decryptResponse(payload) {
  if (!payload?.data || !payload?.necromancer) throw new Error('Moka API returned no encrypted payload');
  const key = Buffer.from(payload.necromancer, 'utf8');
  const iv = Buffer.from(aesIv, 'utf8');
  if (key.length !== 16 || iv.length !== 16) throw new Error('Moka AES key or IV is not 16 bytes');
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  let plaintext = decipher.update(payload.data, 'base64', 'utf8');
  plaintext += decipher.final('utf8');
  return JSON.parse(plaintext);
}

const jobs = [];
let totalAvailable = 0;
let offset = 0;
for (let page = 0; page < maxPages && jobs.length < maxJobs; page += 1) {
  const requestBody = {
    orgId: String(source.org_id),
    siteId: String(source.site_id),
    limit: Math.min(pageSize, maxJobs - jobs.length),
    offset,
    needStat: page === 0,
    jobIdTopList: [],
    customFields: {},
    site: 'campus',
    locale: source.locale || 'zh-CN',
  };
  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(requestBody),
  });
  if (!response.ok) throw new Error(`Moka jobs API returned HTTP ${response.status}`);
  const decrypted = decryptResponse(await response.json());
  if (!decrypted?.success || !Array.isArray(decrypted?.data?.jobs)) {
    throw new Error(decrypted?.msg || 'Moka jobs API returned an unexpected response');
  }
  const batch = decrypted.data.jobs;
  if (page === 0) totalAvailable = Number(decrypted.data.jobStats?.total || batch.length);
  jobs.push(...batch.slice(0, maxJobs - jobs.length));
  if (!batch.length || batch.length < requestBody.limit) break;
  offset += batch.length;
  if (totalAvailable && offset >= totalAvailable) break;
}

process.stdout.write(JSON.stringify({ totalAvailable, fetched: jobs.length, jobs }));
