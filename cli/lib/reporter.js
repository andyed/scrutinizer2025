/**
 * Reporter — format analysis results as JSON, console table, or HTML.
 */

const fs = require('fs');
const path = require('path');

/**
 * Build the output JSON structure matching the spec schema.
 */
function buildReport(pageResults, opts = {}) {
    const pages = [];
    let totalScore = 0;
    let maxScore = 0;
    let minScore = Infinity;
    let count = 0;

    for (const [url, captures] of pageResults) {
        const pageCaps = [];
        for (const cap of captures) {
            if (cap.error) {
                pageCaps.push({
                    viewport: { name: cap.viewport.name, width: cap.viewport.width, height: cap.viewport.height },
                    scrollPosition: cap.scrollPosition,
                    error: cap.error
                });
                continue;
            }

            pageCaps.push({
                viewport: { name: cap.viewport.name, width: cap.viewport.width, height: cap.viewport.height },
                scrollPosition: cap.scrollPosition,
                score: cap.analysis.score,
                rating: cap.analysis.rating,
                congestion: cap.analysis.congestion,
                edgeDensity: cap.analysis.edgeDensity,
                computeTimeMs: cap.analysis.computeTimeMs
            });

            totalScore += cap.analysis.score;
            maxScore = Math.max(maxScore, cap.analysis.score);
            minScore = Math.min(minScore, cap.analysis.score);
            count++;
        }
        pages.push({ url, captures: pageCaps });
    }

    if (minScore === Infinity) minScore = 0;

    return {
        generator: 'scrutinizer-audit',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        summary: {
            pagesAnalyzed: count,
            avgScore: count > 0 ? Math.round(totalScore / count) : 0,
            maxScore,
            minScore,
            threshold: opts.failAbove || null,
            pass: opts.failAbove ? maxScore <= opts.failAbove : true
        },
        pages
    };
}

/**
 * Print a console table summarizing results.
 */
function printTable(report) {
    const rows = [];
    for (const page of report.pages) {
        for (const cap of page.captures) {
            if (cap.error) {
                rows.push({
                    URL: truncate(page.url, 50),
                    Viewport: cap.viewport.name,
                    Scroll: cap.scrollPosition,
                    Score: 'ERR',
                    Rating: cap.error
                });
            } else {
                rows.push({
                    URL: truncate(page.url, 50),
                    Viewport: cap.viewport.name,
                    Scroll: cap.scrollPosition,
                    Score: cap.score,
                    Rating: cap.rating,
                    'Cong p90': cap.congestion.p90.toFixed(3),
                    'Edge p90': cap.edgeDensity.p90.toFixed(3),
                    'Time': cap.computeTimeMs + 'ms'
                });
            }
        }
    }

    if (rows.length === 0) {
        console.log('No results.');
        return;
    }

    console.log('');
    console.table(rows);

    const s = report.summary;
    console.log(`\nSummary: ${s.pagesAnalyzed} captures | avg=${s.avgScore} min=${s.minScore} max=${s.maxScore}`);
    if (s.threshold !== null) {
        const icon = s.pass ? 'PASS' : 'FAIL';
        console.log(`Threshold: ${s.threshold} → ${icon}`);
    }
}

/**
 * Write report to a file (JSON or HTML).
 */
function writeReport(report, outputPath) {
    const ext = path.extname(outputPath).toLowerCase();

    if (ext === '.html') {
        const html = buildHtmlReport(report);
        fs.writeFileSync(outputPath, html, 'utf-8');
    } else {
        fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
    }
}

/**
 * Build a self-contained HTML report.
 */
function buildHtmlReport(report) {
    const s = report.summary;
    const passColor = s.pass ? '#43a047' : '#d32f2f';
    const passLabel = s.pass !== null ? (s.pass ? 'PASS' : 'FAIL') : '';

    const pageRows = report.pages.map(page =>
        page.captures.map(cap => {
            if (cap.error) {
                return `<tr><td>${esc(page.url)}</td><td>${cap.viewport.name}</td><td>${cap.scrollPosition}</td><td>—</td><td>${esc(cap.error)}</td><td>—</td></tr>`;
            }
            const scoreColor = cap.score <= 25 ? '#43a047' : cap.score <= 50 ? '#f9a825' : cap.score <= 75 ? '#ef6c00' : '#d32f2f';
            return `<tr><td>${esc(page.url)}</td><td>${cap.viewport.name}</td><td>${cap.scrollPosition}</td><td style="color:${scoreColor};font-weight:bold">${cap.score}</td><td>${cap.rating}</td><td>${cap.computeTimeMs}ms</td></tr>`;
        }).join('\n')
    ).join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Scrutinizer Audit Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 960px; margin: 40px auto; padding: 0 20px; background: #1a1a2e; color: #e0e0e0; }
  h1 { color: #fff; }
  .summary { display: flex; gap: 24px; margin: 20px 0; }
  .stat { background: #16213e; padding: 16px 24px; border-radius: 8px; text-align: center; }
  .stat-value { font-size: 32px; font-weight: bold; }
  .stat-label { font-size: 12px; color: #aaa; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 20px 0; }
  th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #2a2a4a; }
  th { color: #aaa; font-size: 12px; text-transform: uppercase; }
  .pass { color: ${passColor}; font-weight: bold; font-size: 20px; }
  .footer { margin-top: 40px; color: #666; font-size: 12px; }
</style>
</head>
<body>
<h1>Scrutinizer Audit</h1>
<div class="summary">
  <div class="stat"><div class="stat-value">${s.avgScore}</div><div class="stat-label">Avg Score</div></div>
  <div class="stat"><div class="stat-value">${s.maxScore}</div><div class="stat-label">Max Score</div></div>
  <div class="stat"><div class="stat-value">${s.minScore}</div><div class="stat-label">Min Score</div></div>
  <div class="stat"><div class="stat-value">${s.pagesAnalyzed}</div><div class="stat-label">Captures</div></div>
  ${s.threshold !== null ? `<div class="stat"><div class="stat-value pass">${passLabel}</div><div class="stat-label">Threshold: ${s.threshold}</div></div>` : ''}
</div>
<table>
<thead><tr><th>URL</th><th>Viewport</th><th>Scroll</th><th>Score</th><th>Rating</th><th>Time</th></tr></thead>
<tbody>
${pageRows}
</tbody>
</table>
<div class="footer">Generated by scrutinizer-audit v${report.version} at ${report.timestamp}</div>
</body>
</html>`;
}

function truncate(str, len) {
    return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a delta report from two JSON reports.
 */
function buildComparisonReport(before, after) {
    const deltas = [];

    for (const afterPage of after.pages) {
        const beforePage = before.pages.find(p => p.url === afterPage.url);
        for (const afterCap of afterPage.captures) {
            if (afterCap.error) continue;

            let beforeCap = null;
            if (beforePage) {
                beforeCap = beforePage.captures.find(c =>
                    c.viewport.name === afterCap.viewport.name &&
                    c.scrollPosition === afterCap.scrollPosition &&
                    !c.error
                );
            }

            deltas.push({
                url: afterPage.url,
                viewport: afterCap.viewport.name,
                scrollPosition: afterCap.scrollPosition,
                before: beforeCap ? beforeCap.score : null,
                after: afterCap.score,
                delta: beforeCap ? afterCap.score - beforeCap.score : null,
                ratingBefore: beforeCap ? beforeCap.rating : null,
                ratingAfter: afterCap.rating
            });
        }
    }

    return {
        generator: 'scrutinizer-audit',
        type: 'comparison',
        timestamp: new Date().toISOString(),
        deltas
    };
}

module.exports = { buildReport, printTable, writeReport, buildComparisonReport };
