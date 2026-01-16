import { mkdir, writeFile, readFile } from "node:fs/promises";
import type { AnalysisContext } from "./context.ts";

export async function analyzeModConfigs(ctx: AnalysisContext) {
    console.log('Analyzing mod configs...');
    const analysisOutputDir = `${process.cwd()}/analysis`;
    await mkdir(analysisOutputDir, { recursive: true });

    /**
     * Analyze a single config type where each mod has exactly one config object
     * Structure: { modName: configObject }
     */
    const analyzeSingleConfigType = async (
        configStore: Record<string, any>,
        configTypeName: string
    ) => {
        console.log(`Analyzing ${configTypeName}...`);
        const fieldAnalysisMap = new Map<string, FieldAnalysis>();

        // Extract fields from each mod's config
        for (const [modName, configData] of Object.entries(configStore)) {
            if (!configData) continue;

            const modFields = extractFieldsFromJson(configData, configTypeName);
            for (const [fieldPath, analysis] of modFields) {
                if (!fieldAnalysisMap.has(fieldPath)) {
                    fieldAnalysisMap.set(fieldPath, {
                        modValues: new Map(),
                        distinctValues: new Set(),
                        fieldType: analysis.fieldType
                    });
                }
                mergeFieldAnalysis(fieldAnalysisMap.get(fieldPath)!, analysis, modName);
            }
        }

        await writeAnalysisSummaries(fieldAnalysisMap, analysisOutputDir, configTypeName);
    };

    /**
     * Analyze a multi-config type where each mod may have multiple config files
     * Structure: { modName: { configFilePath: configObject } }
     */
    const analyzeMultiConfigType = async (
        configStore: Record<string, Record<string, any>>,
        configTypeName: string
    ) => {
        console.log(`Analyzing ${configTypeName}...`);
        const fieldAnalysisMap = new Map<string, FieldAnalysis>();

        // Extract fields from each mod's config files
        for (const [modName, configFiles] of Object.entries(configStore)) {
            if (!configFiles) continue;

            for (const [filePath, configData] of Object.entries(configFiles)) {
                if (!configData) continue;
                const modFields = extractFieldsFromJson(configData, configTypeName);
                for (const [fieldPath, analysis] of modFields) {
                    if (!fieldAnalysisMap.has(fieldPath)) {
                        fieldAnalysisMap.set(fieldPath, {
                            modValues: new Map(),
                            distinctValues: new Set(),
                            fieldType: analysis.fieldType
                        });
                    }
                    mergeFieldAnalysis(fieldAnalysisMap.get(fieldPath)!, analysis, modName);
                }
            }
        }

        await writeAnalysisSummaries(fieldAnalysisMap, analysisOutputDir, configTypeName);
    };

    // Analyze each config type
    await analyzeSingleConfigType(ctx.manifestConfigs, 'manifest');
    await analyzeSingleConfigType(ctx.titleScreenConfigs, 'title-screen');
    await analyzeSingleConfigType(ctx.addonConfigs, 'addon-manifest');
    await analyzeSingleConfigType(ctx.settingConfigs, 'default-config');
    await analyzeMultiConfigType(ctx.planetConfigs, 'planets');
    await analyzeMultiConfigType(ctx.systemConfigs, 'systems');

    // Generate HTML report
    await generateHtmlReport(analysisOutputDir, ['manifest', 'title-screen', 'addon-manifest', 'default-config', 'planets', 'systems']);

    console.log('Analysis complete!');
}

/**
 * Recursively extract fields and their values from a JSON object
 * Returns a map of field paths to FieldAnalysis containing value information
 */
function extractFieldsFromJson(
    obj: any,
    configTypeName: string,
    fieldPath: string = ''
): Map<string, FieldAnalysis> {
    const fieldsMap = new Map<string, FieldAnalysis>()

    if (obj === null || obj === undefined) {
        return fieldsMap
    }

    const objType = Array.isArray(obj) ? 'array' : typeof obj

    // Handle primitives at current level
    if (objType !== 'object' && objType !== 'array') {
        const pathKey = fieldPath || '[root]'
        const valueStr = String(obj)
        const analysis = fieldsMap.get(pathKey) || {
            modValues: new Map(),
            distinctValues: new Set(),
            fieldType: 'primitive'
        }
        analysis.distinctValues.add(valueStr)
        fieldsMap.set(pathKey, analysis)
        return fieldsMap
    }

    // Handle arrays
    if (Array.isArray(obj)) {
        // Check if array contains objects or primitives
        const hasObjects = obj.some(item => item !== null && typeof item === 'object')
        const hasPrimitives = obj.some(item => item === null || typeof item !== 'object')

        if (hasObjects && obj.length > 0) {
            // Array of objects: merge all fields from all objects
            const mergedFields = new Map<string, FieldAnalysis>()
            for (const item of obj) {
                if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
                    const itemFields = extractFieldsFromJson(item, configTypeName, '')
                    for (const [key, analysis] of itemFields) {
                        if (!mergedFields.has(key)) {
                            mergedFields.set(key, {
                                modValues: new Map(),
                                distinctValues: new Set(),
                                fieldType: analysis.fieldType
                            })
                        }
                        const merged = mergedFields.get(key)!
                        for (const value of analysis.distinctValues) {
                            merged.distinctValues.add(value)
                        }
                    }
                }
            }
            // Add merged fields with array prefix
            for (const [key, analysis] of mergedFields) {
                const fullKey = fieldPath ? `${fieldPath}.${key}` : key
                fieldsMap.set(fullKey, analysis)
            }
        }

        if (hasPrimitives) {
            // Array of primitives: treat as set of values
            const pathKey = fieldPath || '[root]'
            const analysis: FieldAnalysis = {
                modValues: new Map(),
                distinctValues: new Set(),
                fieldType: 'array'
            }
            for (const item of obj) {
                if (item !== null && item !== undefined) {
                    analysis.distinctValues.add(String(item))
                }
            }
            if (analysis.distinctValues.size > 0) {
                fieldsMap.set(pathKey, analysis)
            }
        }

        return fieldsMap
    }

    // Handle objects
    for (const [key, value] of Object.entries(obj)) {
        let newPath = fieldPath ? `${fieldPath}.${key}` : key

        // HACK: Treat settings in default-config.json as the same object/field since the keys are dynamic and we want to aggregate them
        if (fieldPath === 'settings' && configTypeName === 'default-config') {
            newPath = `${fieldPath}.{settingName}`
        }

        if (value === null || value === undefined) {
            const analysis: FieldAnalysis = {
                modValues: new Map(),
                distinctValues: new Set(['null']),
                fieldType: 'primitive'
            }
            fieldsMap.set(newPath, analysis)
        } else if (Array.isArray(value) || (typeof value === 'object')) {
            const nestedFields = extractFieldsFromJson(value, configTypeName, newPath)
            for (const [nestedKey, analysis] of nestedFields) {
                fieldsMap.set(nestedKey, analysis)
            }
        } else {
            // Primitive value
            const analysis: FieldAnalysis = {
                modValues: new Map(),
                distinctValues: new Set([String(value)]),
                fieldType: 'primitive'
            }
            fieldsMap.set(newPath, analysis)
        }
    }

    return fieldsMap
}

/**
 * Merge field analyses from a mod into a combined analysis, tracking which mod contributed which values
 */

function mergeFieldAnalysis(
    combinedAnalysis: FieldAnalysis,
    modAnalysis: FieldAnalysis,
    modName: string
): void {
    if (!combinedAnalysis.modValues.has(modName)) {
        combinedAnalysis.modValues.set(modName, new Set())
    }

    const modValues = combinedAnalysis.modValues.get(modName)!
    for (const value of modAnalysis.distinctValues) {
        modValues.add(value)
        combinedAnalysis.distinctValues.add(value)
    }
}

/**
 * Build per-mod summaries from field analyses
 */
function buildPerModSummaries(
    fieldAnalysisMap: Map<string, FieldAnalysis>
): Record<string, PerModFieldInfo[]> {
    const perModSummaries: Record<string, PerModFieldInfo[]> = {}

    for (const [fieldPath, analysis] of fieldAnalysisMap) {
        for (const [modName, values] of analysis.modValues) {
            if (!perModSummaries[modName]) {
                perModSummaries[modName] = []
            }
            perModSummaries[modName].push({
                fieldPath,
                fieldType: analysis.fieldType,
                values: Array.from(values).sort()
            })
        }
    }

    // Sort field paths within each mod for consistency
    for (const modName in perModSummaries) {
        perModSummaries[modName].sort((a, b) => a.fieldPath.localeCompare(b.fieldPath))
    }

    return perModSummaries
}

/**
 * Build per-field summaries from field analyses
 */
function buildPerFieldSummaries(
    fieldAnalysisMap: Map<string, FieldAnalysis>
): Record<string, PerFieldSummary> {
    const perFieldSummaries: Record<string, PerFieldSummary> = {}

    for (const [fieldPath, analysis] of fieldAnalysisMap) {
        const mods: PerFieldModInfo[] = []
        for (const [modName, values] of analysis.modValues) {
            mods.push({
                modName,
                values: Array.from(values).sort()
            })
        }
        mods.sort((a, b) => a.modName.localeCompare(b.modName))

        perFieldSummaries[fieldPath] = {
            fieldType: analysis.fieldType,
            mods,
            distinctValues: Array.from(analysis.distinctValues).sort()
        }
    }

    return perFieldSummaries
}

/**
 * Write analysis summaries to output files
 */
async function writeAnalysisSummaries(
    fieldAnalysisMap: Map<string, FieldAnalysis>,
    analysisOutputDir: string,
    configTypeName: string
): Promise<void> {
    const perModSummary = buildPerModSummaries(fieldAnalysisMap)
    const perFieldSummary = buildPerFieldSummaries(fieldAnalysisMap)

    const typeOutputDir = `${analysisOutputDir}/${configTypeName}`
    await mkdir(typeOutputDir, { recursive: true })

    await writeFile(
        `${typeOutputDir}/per-mod-summary.json`,
        JSON.stringify(perModSummary, null, 2)
    )

    await writeFile(
        `${typeOutputDir}/per-field-summary.json`,
        JSON.stringify(perFieldSummary, null, 2)
    )

    console.log(`  Analyzed ${Object.keys(perModSummary).length} mods with ${fieldAnalysisMap.size} unique fields`)
}

interface FieldAnalysis {
    modValues: Map<string, Set<string>> // modName -> set of string representations of values
    distinctValues: Set<string>
    fieldType: 'primitive' | 'object' | 'array'
}

interface PerModFieldInfo {
    fieldPath: string
    fieldType: 'primitive' | 'object' | 'array'
    values: string[]
}

interface PerFieldModInfo {
    modName: string
    values: string[]
}

interface PerFieldSummary {
    fieldType: 'primitive' | 'object' | 'array'
    mods: PerFieldModInfo[]
    distinctValues: string[]
}

/**
 * Generate an interactive HTML report from the analysis data
 */
async function generateHtmlReport(
    analysisOutputDir: string,
    configTypes: string[]
): Promise<void> {
    const configTypeData: Record<string, Record<string, PerFieldSummary>> = {}

    // Load per-field summaries for each config type
    for (const configType of configTypes) {
        try {
            const summaryPath = `${analysisOutputDir}/${configType}/per-field-summary.json`
            const content = await readFile(summaryPath, 'utf-8')
            configTypeData[configType] = JSON.parse(content)
        } catch (error) {
            console.warn(`Could not load summary for ${configType}: ${error}`)
        }
    }

    // Build the HTML
    const html = buildHtmlDocument(configTypeData)

    // Write to file
    await writeFile(`${analysisOutputDir}/index.html`, html)
    console.log('Generated HTML report: analysis/index.html')
}

/**
 * Build the complete HTML document with CSS and interactivity
 */
function buildHtmlDocument(configTypeData: Record<string, Record<string, PerFieldSummary>>): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Config Analysis Report</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background-color: #0b1220;
            color: #e5e7eb;
            line-height: 1.6;
            padding: 20px;
        }
        
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: #111827;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        }
        
        .header {
            background: linear-gradient(135deg, #1f2937 0%, #0f172a 100%);
            color: white;
            padding: 30px;
        }
        
        .header h1 {
            font-size: 2em;
            margin-bottom: 10px;
        }
        
        .header p {
            font-size: 0.95em;
        }
        
        .content {
            padding: 30px;
        }
        
        .config-type {
            margin-bottom: 30px;
            border: 1px solid #1f2937;
            border-radius: 6px;
        }
        
        .config-type-header {
            background-color: #111827;
            padding: 15px 20px;
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 10px;
            border-bottom: 1px solid #1f2937;
            font-weight: 600;
            color: #c4b5fd;
            transition: background-color 0.2s;
        }
        
        .config-type-header:hover {
            background-color: #1f2937;
        }
        
        .toggle-icon {
            display: inline-block;
            width: 20px;
            height: 20px;
            transition: transform 0.3s;
        }
        
        .config-type-header.collapsed .toggle-icon {
            transform: rotate(-90deg);
        }
        
        .config-type-content {
            padding: 20px;
        }
        
        .config-type-content.collapsed {
            display: none;
        }
        
        .field {
            margin-bottom: 15px;
            background-color: #0f172a;
            border-left: 3px solid #a78bfa;
            padding: 12px 15px;
            border-radius: 4px;
        }
        
        .field-header {
            cursor: pointer;
            user-select: none;
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
        }
        
        .field-toggle {
            display: inline-block;
            width: 16px;
            height: 16px;
            transition: transform 0.2s;
            color: #c4b5fd;
            font-weight: bold;
        }
        
        .field-header.collapsed .field-toggle {
            transform: rotate(-90deg);
        }
        
        .field-name {
            font-weight: 600;
            color: #e5e7eb;
            word-break: break-word;
        }
        
        .field-header:hover > .field-name {
            color: #a78bfa;
        }
        
        .field-type {
            display: inline-block;
            font-size: 0.8em;
            background-color: #1f2937;
            color: #cbd5e1;
            padding: 2px 8px;
            border-radius: 12px;
            margin-left: 10px;
        }

        .field-mods {
            position: relative;
            display: flex;
            align-items: center;
            margin-left: 8px;
        }
        
        .field-values {
            margin-left: 24px;
        }
        
        .field-values.collapsed {
            display: none;
        }
        
        .value-item {
            padding: 8px 12px;
            margin-bottom: 6px;
            background-color: #0d1528;
            border: 1px solid #1f2937;
            border-radius: 4px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            cursor: pointer;
            position: relative;
        }
        
        .value-item:hover {
            background-color: #111827;
            border-color: #a78bfa;
        }
        
        .value-text {
            flex: 1;
            font-family: 'Courier New', monospace;
            font-size: 0.9em;
            color: #e5e7eb;
            word-break: break-word;
            max-width: 70%;
        }
        
        .value-mod-count {
            display: inline-block;
            background-color: #a78bfa;
            color: #0b1220;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.85em;
            font-weight: 600;
        }
        
        .mod-tooltip {
            position: absolute;
            bottom: 100%;
            left: 50%;
            transform: translateX(-50%);
            background-color: #111827;
            color: #e5e7eb;
            padding: 10px 15px;
            border-radius: 6px;
            font-size: 0.85em;
            white-space: nowrap;
            z-index: 1000;
            margin-bottom: 8px;
            pointer-events: none;
            max-width: 750px;
            white-space: normal;
            word-break: break-word;
        }
        
        .mod-tooltip::after {
            content: '';
            position: absolute;
            top: 100%;
            left: 50%;
            transform: translateX(-50%);
            border: 6px solid transparent;
            border-top-color: #111827;
        }
        
        .mod-count {
            display: none;
            position: absolute;
            background: #0f172a;
            border: 1px solid #1f2937;
            border-radius: 6px;
            padding: 12px;
            bottom: calc(100% + 12px);
            left: 50%;
            transform: translateX(-50%);
            z-index: 1000;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 0.9em;
            color: #e5e7eb;
            max-width: 750px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
            white-space: normal;
        }
        
        .mod-count::after {
            content: '';
            position: absolute;
            bottom: -6px;
            left: 50%;
            transform: translateX(-50%);
            border: 6px solid transparent;
            border-top-color: #0f172a;
            border-right-color: #0f172a;
            border-left-color: #0f172a;
        }
        
        .value-item:hover .mod-count,
        .field-mods:hover .mod-count {
            display: block;
        }
        
        .mods-header {
            font-weight: 600;
            color: #c4b5fd;
            margin-bottom: 8px;
            font-size: 0.95em;
        }
        
        .mod-list {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        
        .mod-badge {
            background-color: #1f2937;
            color: #c4b5fd;
            padding: 4px 10px;
            border-radius: 4px;
            font-size: 0.85em;
        }
        
        .stats {
            margin-bottom: 30px;
            padding: 20px;
            background-color: #0f172a;
            border-radius: 6px;
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
        }
        
        .stat-box {
            text-align: center;
        }
        
        .stat-number {
            font-size: 2em;
            font-weight: bold;
            color: #c4b5fd;
        }
        
        .stat-label {
            color: #cbd5e1;
            font-size: 0.9em;
            margin-top: 5px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📊 Config Analysis Report</h1>
            <p>Interactive exploration of mod configuration files</p>
        </div>
        
        <div class="content">
            <div class="stats">
                ${getStatisticsHtml(configTypeData)}
            </div>
            
            ${getConfigTypesHtml(configTypeData)}
        </div>
    </div>
    
    <script>
        // Collapse/expand config types
        document.querySelectorAll('.config-type-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('collapsed');
                const content = header.nextElementSibling;
                content.classList.toggle('collapsed');
            });
        });
        
        // Collapse/expand fields
        document.querySelectorAll('.field-header').forEach(header => {
            header.addEventListener('click', (e) => {
                e.stopPropagation();
                header.classList.toggle('collapsed');
                const values = header.parentElement.querySelector('.field-values');
                if (values) {
                    values.classList.toggle('collapsed');
                }
            });
        });
        
        // Show/hide mod list on value hover
        document.querySelectorAll('.value-item').forEach(item => {
            item.addEventListener('mouseenter', () => {
                const tooltip = item.querySelector('.mod-count');
                if (tooltip) {
                    tooltip.style.display = 'block';
                }
            });
            item.addEventListener('mouseleave', () => {
                const tooltip = item.querySelector('.mod-count');
                if (tooltip) {
                    tooltip.style.display = 'none';
                }
            });
        });
    </script>
</body>
</html>`
}

/**
 * Generate statistics section HTML
 */
function getStatisticsHtml(configTypeData: Record<string, Record<string, PerFieldSummary>>): string {
    const totalMods = new Set<string>()
    for (const type of Object.values(configTypeData)) {
        for (const field of Object.values(type)) {
            for (const mod of field.mods) {
                totalMods.add(mod.modName)
            }
        }
    }
    let totalFields = 0
    let totalValues = 0

    for (const type of Object.values(configTypeData)) {
        totalFields += Object.keys(type).length
        for (const field of Object.values(type)) {
            totalValues += field.distinctValues.length
        }
    }

    return `
        <div class="stat-box">
            <div class="stat-number">${totalMods.size}</div>
            <div class="stat-label">Mods</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${totalFields}</div>
            <div class="stat-label">Unique Fields</div>
        </div>
        <div class="stat-box">
            <div class="stat-number">${totalValues}</div>
            <div class="stat-label">Distinct Values</div>
        </div>
    `
}

/**
 * Generate config types section HTML
 */
function getConfigTypesHtml(configTypeData: Record<string, Record<string, PerFieldSummary>>): string {
    return Object.entries(configTypeData)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([configType, fields]) => getConfigTypeHtml(configType, fields))
        .join('')
}

/**
 * Generate a single config type HTML section
 */
function getConfigTypeHtml(configType: string, fields: Record<string, PerFieldSummary>): string {
    const sortedFields = Object.entries(fields)
        .sort(([a], [b]) => a.localeCompare(b))

    return `
        <div class="config-type">
            <div class="config-type-header">
                <span class="toggle-icon">▼</span>
                <span>${escapeHtml(configType)}</span>
                <span style="margin-left: auto; font-size: 0.85em; font-weight: normal; color: #999;">${sortedFields.length} fields</span>
            </div>
            <div class="config-type-content">
                ${sortedFields.map(([fieldName, fieldData]) => getFieldHtml(fieldName, fieldData)).join('')}
            </div>
        </div>
    `
}

/**
 * Generate a field HTML section
 */
function getFieldHtml(fieldName: string, fieldData: PerFieldSummary): string {
    const sortedValues = fieldData.distinctValues.sort()
    const valuesByMod: Record<string, string[]> = {}
    const modNames = fieldData.mods.map(mod => mod.modName).sort()
    const modCount = modNames.length

    // Build a map of values to their mods
    for (const mod of fieldData.mods) {
        for (const value of mod.values) {
            if (!valuesByMod[value]) {
                valuesByMod[value] = []
            }
            valuesByMod[value].push(mod.modName)
        }
    }

    return `
        <div class="field">
            <div class="field-header collapsed">
                <span class="field-toggle">▼</span>
                <span class="field-name">${escapeHtml(fieldName)}</span>
                <span class="field-type">${fieldData.fieldType}</span>
                <div class="field-mods">
                    <span class="value-mod-count">${modCount}</span>
                    <div class="mod-count">
                        <div class="mods-header">Present in ${modCount} mod${modCount !== 1 ? 's' : ''}:</div>
                        <div class="mod-list">
                            ${modNames.map(mod => `<span class="mod-badge">${escapeHtml(mod)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <span style="margin-left: auto; font-size: 0.85em; font-weight: normal; color: #999;">${sortedValues.length} values</span>
            </div>
            <div class="field-values collapsed">
                ${sortedValues.map(value => getValueItemHtml(value, valuesByMod[value] || [])).join('')}
            </div>
        </div>
    `
}

/**
 * Generate a value item HTML
 */
function getValueItemHtml(value: string, mods: string[]): string {
    const modCount = mods.length
    const sortedMods = mods.sort()

    return `
        <div class="value-item">
            <span class="value-text">${escapeHtml(value)}</span>
            <span class="value-mod-count">${modCount}</span>
            <div class="mod-count">
                <div class="mods-header">Used by ${modCount} mod${modCount !== 1 ? 's' : ''}:</div>
                <div class="mod-list">
                    ${sortedMods.map(mod => `<span class="mod-badge">${escapeHtml(mod)}</span>`).join('')}
                </div>
            </div>
        </div>
    `
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    const map: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    }
    return text.replace(/[&<>"']/g, char => map[char])
}

