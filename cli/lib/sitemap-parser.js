/**
 * Sitemap parser — extract URLs from an XML sitemap.
 *
 * Handles standard sitemap.xml with <url><loc> entries.
 * Does not handle sitemap index files (future enhancement).
 */

const https = require('https');
const http = require('http');

/**
 * Fetch a URL and return its body as a string.
 */
function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location).then(resolve, reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Parse URLs from an XML sitemap string.
 * Uses regex — no XML parser dependency needed for this simple format.
 */
function parseUrls(xml) {
    const urls = [];
    const locRegex = /<loc>\s*(.*?)\s*<\/loc>/gi;
    let match;
    while ((match = locRegex.exec(xml)) !== null) {
        const url = match[1].trim();
        if (url) urls.push(url);
    }
    return urls;
}

/**
 * Fetch and parse a sitemap URL.
 * @param {string} sitemapUrl
 * @returns {Promise<string[]>} Array of page URLs
 */
async function fetchSitemap(sitemapUrl) {
    const xml = await fetchUrl(sitemapUrl);
    return parseUrls(xml);
}

module.exports = { fetchSitemap, parseUrls };
