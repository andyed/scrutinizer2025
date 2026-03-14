/**
 * Citation-Ready Export Utility
 * 
 * Embeds experiment metadata into PNG files for academic reproducibility.
 * Uses PNG tEXt chunks to store configuration, version, and citation information.
 * 
 * @example
 * const { embedMetadata, extractMetadata, captureWithMetadata } = require('./citation-export');
 * 
 * // Embed metadata into an existing PNG buffer
 * const annotatedBuffer = await embedMetadata(pngBuffer, {
 *     mode: 'blueprint',
 *     foveaRadius: 180,
 *     degradationStrength: 0.6,
 *     url: 'https://example.com'
 * });
 * 
 * // Extract metadata from a PNG file
 * const metadata = await extractMetadata(filePath);
 * console.log(metadata.cite_as); // "Scrutinizer v1.4.4, Blueprint Mode"
 */

const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

// Load version and modes registry
let version = 'unknown';
let modesRegistry = null;

try {
    const packagePath = path.join(__dirname, '..', 'package.json');
    version = JSON.parse(fs.readFileSync(packagePath, 'utf8')).version;
} catch (e) {
    console.warn('[CitationExport] Could not load package.json:', e.message);
}

try {
    const modesPath = path.join(__dirname, '..', 'shared', 'modes.json');
    modesRegistry = JSON.parse(fs.readFileSync(modesPath, 'utf8'));
} catch (e) {
    console.warn('[CitationExport] Could not load modes.json:', e.message);
}

/**
 * Standard metadata fields for Scrutinizer exports
 */
const METADATA_FIELDS = {
    // Core identification
    'Scrutinizer:Version': version,
    'Software': `Scrutinizer v${version}`,

    // Standard PNG metadata
    'Author': '',
    'Description': '',
    'Copyright': '',
    'Creation Time': '',

    // Scrutinizer-specific (prefixed for namespacing)
    'Scrutinizer:Mode': '',
    'Scrutinizer:ModeId': '',
    'Scrutinizer:FoveaRadius': '',
    'Scrutinizer:FoveaDeg': '',
    'Scrutinizer:PxPerDeg': '',
    'Scrutinizer:FoveaAspect': '',
    'Scrutinizer:DegradationStrength': '',
    'Scrutinizer:URL': '',
    'Scrutinizer:Timestamp': '',
    'Scrutinizer:Pipeline': '',
    'Scrutinizer:CiteAs': ''
};

/**
 * Generate a citation string for academic use
 * @param {Object} config - Current configuration
 * @returns {string} Citation string
 */
function generateCitation(config) {
    const modeLabel = config.modeLabel || `Mode ${config.modeId || 0}`;
    const timestamp = config.timestamp || new Date().toISOString();
    const dateStr = timestamp.split('T')[0];

    return `Scrutinizer v${version}, ${modeLabel} (Captured ${dateStr})`;
}

/**
 * Build metadata object from current state
 * @param {Object} options - Current renderer/simulation state
 * @returns {Object} Metadata key-value pairs
 */
function buildMetadata(options = {}) {
    const {
        modeId = 0,
        modeName = null,
        foveaRadius = 180,
        foveaDeg = 1.0, // foveal radius in degrees (1° = anatomical fovea radius)
        foveaAspect = 1.33,
        degradationStrength = 0.6,
        intensity, // deprecated alias
        caStrength = 1.0,
        url = '',
        pipeline = null,
        customFields = {}
    } = options;

    // Derive px/deg from radius and angular size
    const pxPerDeg = foveaDeg > 0 ? foveaRadius / foveaDeg : foveaRadius;

    // Support old 'intensity' callers during transition
    const strength = degradationStrength !== 0.6 ? degradationStrength
        : (intensity !== undefined ? intensity : 0.6);

    // Look up mode info from registry
    let modeLabel = `Mode ${modeId}`;
    let modeDescription = '';
    let modeCitations = {};

    if (modesRegistry && modesRegistry.modes) {
        const modeEntry = Object.entries(modesRegistry.modes).find(([key, m]) =>
            m.id === modeId || key === modeName
        );

        if (modeEntry) {
            const [key, mode] = modeEntry;
            modeLabel = mode.label || mode.shortLabel || key;
            modeDescription = mode.description || '';
            modeCitations = mode.citations || {};
        }
    }

    const timestamp = new Date().toISOString();

    const metadata = {
        // Standard PNG fields
        'Software': `Scrutinizer v${version}`,
        'Creation Time': timestamp,
        'Description': modeDescription,

        // Scrutinizer-specific fields
        'Scrutinizer:Version': version,
        'Scrutinizer:Mode': modeLabel,
        'Scrutinizer:ModeId': String(modeId),
        'Scrutinizer:FoveaRadius': String(foveaRadius),
        'Scrutinizer:FoveaDeg': String(foveaDeg),
        'Scrutinizer:PxPerDeg': String(Math.round(pxPerDeg * 100) / 100),
        'Scrutinizer:FoveaAspect': String(foveaAspect),
        'Scrutinizer:DegradationStrength': String(strength),
        'Scrutinizer:CAStrength': String(caStrength),
        'Scrutinizer:URL': url,
        'Scrutinizer:Timestamp': timestamp,
        'Scrutinizer:CiteAs': generateCitation({ modeId, modeLabel, timestamp }),

        // Scientific context
        'Scrutinizer:Technique': modeCitations.technique || '',
        'Scrutinizer:BiologicalBasis': modeCitations.biological_basis || '',

        // Custom fields
        ...Object.fromEntries(
            Object.entries(customFields).map(([k, v]) => [`Scrutinizer:${k}`, String(v)])
        )
    };

    // Include full pipeline config as JSON (for reproducibility)
    if (pipeline) {
        metadata['Scrutinizer:Pipeline'] = JSON.stringify(pipeline);
    }

    return metadata;
}

/**
 * Embed metadata into a PNG buffer
 * @param {Buffer} pngBuffer - Original PNG image buffer
 * @param {Object} options - Metadata options (same as buildMetadata)
 * @returns {Promise<Buffer>} PNG buffer with embedded metadata
 */
async function embedMetadata(pngBuffer, options = {}) {
    return new Promise((resolve, reject) => {
        const png = new PNG();

        png.parse(pngBuffer, (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            // Build metadata
            const metadata = buildMetadata(options);

            // PNG.js uses the 'text' property for tEXt chunks
            // Each entry becomes a tEXt chunk in the output
            data.text = data.text || {};

            for (const [key, value] of Object.entries(metadata)) {
                if (value) { // Only include non-empty values
                    data.text[key] = value;
                }
            }

            // Re-pack the PNG
            const chunks = [];
            const stream = data.pack();

            stream.on('data', chunk => chunks.push(chunk));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
    });
}

/**
 * Extract metadata from a PNG file
 * @param {string|Buffer} input - File path or PNG buffer
 * @returns {Promise<Object>} Extracted metadata
 */
async function extractMetadata(input) {
    return new Promise((resolve, reject) => {
        const png = new PNG();

        const buffer = typeof input === 'string'
            ? fs.readFileSync(input)
            : input;

        png.parse(buffer, (err, data) => {
            if (err) {
                reject(err);
                return;
            }

            const metadata = data.text || {};

            // Parse pipeline JSON if present
            if (metadata['Scrutinizer:Pipeline']) {
                try {
                    metadata['Scrutinizer:Pipeline:Parsed'] = JSON.parse(metadata['Scrutinizer:Pipeline']);
                } catch (e) {
                    // Keep as string if parsing fails
                }
            }

            resolve(metadata);
        });
    });
}

/**
 * Save a canvas or image buffer with embedded metadata
 * @param {Buffer} imageBuffer - PNG image buffer
 * @param {string} filePath - Output file path
 * @param {Object} options - Metadata options
 * @returns {Promise<string>} Saved file path
 */
async function saveWithMetadata(imageBuffer, filePath, options = {}) {
    const annotatedBuffer = await embedMetadata(imageBuffer, options);
    fs.writeFileSync(filePath, annotatedBuffer);
    console.log(`[CitationExport] Saved with metadata: ${filePath}`);
    return filePath;
}

/**
 * Generate a companion JSON sidecar file with full metadata
 * (For systems that don't support PNG metadata extraction)
 * @param {string} pngPath - Path to PNG file
 * @param {Object} options - Metadata options
 * @returns {string} Path to JSON sidecar
 */
function generateSidecar(pngPath, options = {}) {
    const metadata = buildMetadata(options);
    const sidecarPath = pngPath.replace(/\.png$/i, '.meta.json');

    const sidecar = {
        source_image: path.basename(pngPath),
        generated: new Date().toISOString(),
        scrutinizer: {
            version,
            cite_as: metadata['Scrutinizer:CiteAs']
        },
        configuration: {
            mode: metadata['Scrutinizer:Mode'],
            mode_id: parseInt(metadata['Scrutinizer:ModeId']),
            fovea_radius: parseFloat(metadata['Scrutinizer:FoveaRadius']),
            fovea_deg: parseFloat(metadata['Scrutinizer:FoveaDeg']),
            px_per_deg: parseFloat(metadata['Scrutinizer:PxPerDeg']),
            fovea_aspect: parseFloat(metadata['Scrutinizer:FoveaAspect']),
            degradationStrength: parseFloat(metadata['Scrutinizer:DegradationStrength']),
            url: metadata['Scrutinizer:URL']
        },
        scientific_context: {
            technique: metadata['Scrutinizer:Technique'],
            biological_basis: metadata['Scrutinizer:BiologicalBasis']
        },
        full_metadata: metadata
    };

    fs.writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2));
    console.log(`[CitationExport] Generated sidecar: ${sidecarPath}`);
    return sidecarPath;
}

module.exports = {
    buildMetadata,
    embedMetadata,
    extractMetadata,
    saveWithMetadata,
    generateSidecar,
    generateCitation,
    METADATA_FIELDS,
    version
};
