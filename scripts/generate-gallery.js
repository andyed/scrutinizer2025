const fs = require('fs');
const path = require('path');

const CAPTURE_DIR = path.join(__dirname, '../tests/golden-captures/v1.4.1');
const OUTPUT_FILE = path.join(CAPTURE_DIR, 'gallery.html');

console.log(`Scanning: ${CAPTURE_DIR}`);

if (!fs.existsSync(CAPTURE_DIR)) {
    console.error(`Directory not found: ${CAPTURE_DIR}`);
    process.exit(1);
}

const files = fs.readdirSync(CAPTURE_DIR).filter(f => f.endsWith('.png'));
const pages = {};

// Group by page name (everything before the first underscore)
files.forEach(file => {
    const parts = file.split('_');
    const pageName = parts[0];
    if (!pages[pageName]) pages[pageName] = [];
    pages[pageName].push(file);
});

// Sort variants naturally
Object.keys(pages).forEach(page => {
    pages[page].sort((a, b) => {
        // Overlay last
        if (a.includes('overlay') && !b.includes('overlay')) return 1;
        if (!a.includes('overlay') && b.includes('overlay')) return -1;
        // Center first
        if (a.includes('center') && !b.includes('center')) return -1;
        if (!a.includes('center') && b.includes('center')) return 1;
        return a.localeCompare(b);
    });
});

const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Golden Image Gallery v1.4.1</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #111; color: #eee; padding: 20px; }
        h1 { border-bottom: 1px solid #333; padding-bottom: 10px; }
        .page-section { margin-bottom: 40px; }
        .page-title { font-size: 1.5em; margin-bottom: 15px; color: #8ab4f8; text-transform: capitalize; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
        .card { background: #222; border-radius: 8px; overflow: hidden; border: 1px solid #333; transition: transform 0.2s; }
        .card:hover { transform: scale(1.02); border-color: #555; }
        .card img { width: 100%; height: auto; display: block; }
        .card-label { padding: 10px; font-size: 0.9em; color: #ccc; background: #1a1a1a; border-top: 1px solid #333; }
        .variant-name { font-weight: bold; color: #fff; }
    </style>
</head>
<body>
    <h1>Golden Image Gallery: v1.4.1</h1>
    <p>Generated on ${new Date().toLocaleString()}</p>
    
    ${Object.keys(pages).map(page => `
        <div class="page-section">
            <div class="page-title">${page}</div>
            <div class="grid">
                ${pages[page].map(file => `
                    <div class="card">
                        <a href="${file}" target="_blank">
                            <img src="${file}" loading="lazy" alt="${file}">
                        </a>
                        <div class="card-label">
                            <div class="variant-name">${file.replace(page + '_', '').replace('.png', '').replace(/_/g, ' ')}</div>
                            <div style="font-size: 0.8em; opacity: 0.7">${file}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `).join('')}

    ${Object.keys(pages).length === 0 ? '<p>No images found in directory.</p>' : ''}
</body>
</html>
`;

fs.writeFileSync(OUTPUT_FILE, html);
console.log(`Gallery generated at: ${OUTPUT_FILE}`);
