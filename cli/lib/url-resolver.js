/**
 * URL resolver — consolidate URLs from positional args, --file, and --sitemap.
 */

const fs = require('fs');
const { fetchSitemap } = require('./sitemap-parser');

/**
 * Resolve all URL sources into a flat array.
 *
 * @param {{ positional: string[], file?: string, sitemap?: string }} sources
 * @returns {Promise<string[]>} Deduplicated URL list
 */
async function resolveUrls(sources) {
    const urls = new Set();

    // Positional URLs
    if (sources.positional) {
        for (const u of sources.positional) {
            urls.add(normalizeUrl(u));
        }
    }

    // --file: one URL per line
    if (sources.file) {
        const content = fs.readFileSync(sources.file, 'utf-8');
        for (const line of content.split('\n')) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                urls.add(normalizeUrl(trimmed));
            }
        }
    }

    // --sitemap: XML sitemap
    if (sources.sitemap) {
        const sitemapUrls = await fetchSitemap(sources.sitemap);
        for (const u of sitemapUrls) {
            urls.add(u);
        }
    }

    return [...urls];
}

/**
 * Ensure URL has a protocol prefix.
 */
function normalizeUrl(url) {
    if (!/^https?:\/\//i.test(url)) {
        return 'https://' + url;
    }
    return url;
}

module.exports = { resolveUrls, normalizeUrl };
