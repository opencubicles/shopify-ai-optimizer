import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
    try {
        const dataPath = path.join(process.cwd(), "..", "data", "audit-result.json");
        if (!fs.existsSync(dataPath)) {
            return NextResponse.json({ error: 'No saved audit found' }, { status: 404 });
        }

        const dataStr = fs.readFileSync(dataPath, 'utf8');
        const data = JSON.parse(dataStr);

        // LOAD STRATEGY MANIFEST (generated-fixes.json)
        let availableFixes = [];
        try {
            const manifestPath = path.join(process.cwd(), "..", "data", "generated-fixes.json");
            if (fs.existsSync(manifestPath)) {
                const manifestRaw = fs.readFileSync(manifestPath, "utf-8");
                const manifest = JSON.parse(manifestRaw);
                availableFixes = manifest.fixes || [];
                console.log(`[last-audit] Loaded ${availableFixes.length} fixes from manifest.`);
            } else {
                console.error("[last-audit] Manifest file NOT FOUND at", manifestPath);
            }
        } catch (err: any) {
            console.error("[last-audit] Failed to load manifest:", err.message);
        }

        // AUTO-INJECT A TEST FIX FOR DEBUGGING
        availableFixes.push({
            id: "MANUAL-TEST-FIX",
            title: "Manual Debug Trigger [v2.3]",
            targetAsset: "wizzyFrontend.min.css",
            fixedSnippet: "// MANUAL TEST"
        });

        // Inject AI features if HTML report exists
        if (data.html) {
            // CLEANUP PREVIOUS INJECTIONS TO PREVENT DUPES
            let htmlReport = data.html;
            htmlReport = htmlReport.replace(/<style class="ai-styles">[\s\S]*?<\/style>/g, "");
            htmlReport = htmlReport.replace(/<script class="ai-script">[\s\S]*?<\/script>/g, "");

            const customStyles = `
                <style class="ai-styles">
                    .ai-badge-injector {
                        display: inline-flex;
                        align-items: center;
                        background: linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%);
                        color: white !important;
                        font-size: 10px;
                        padding: 3px 10px;
                        border-radius: 100px;
                        margin-left: 10px;
                        font-weight: 700;
                        box-shadow: 0 4px 10px rgba(124,58,237,0.3);
                        letter-spacing: 0.5px;
                        animation: ai-pulse 2s infinite;
                        cursor: pointer;
                        vertical-align: middle;
                    }
                    @keyframes ai-pulse {
                        0% { box-shadow: 0 0 0 0 rgba(124,58,237,0.6); }
                        70% { box-shadow: 0 0 0 8px rgba(124,58,237,0); }
                        100% { box-shadow: 0 0 0 0 rgba(124,58,237,0); }
                    }
                    .ai-strategy-card {
                        background: #f5f3ff;
                        border-left: 4px solid #7c3aed;
                        padding: 12px 16px;
                        margin: 12px 0;
                        border-radius: 6px;
                    }
                    .ai-strategy-card strong {
                        display: block;
                        font-size: 14px;
                        color: #4338ca;
                        margin-bottom: 4px;
                    }
                    .ai-strategy-card p {
                        margin: 0;
                        font-size: 12px;
                        color: #312e81;
                    }
                    .ai-row-action {
                        background: #7c3aed;
                        color: white !important;
                        border: none;
                        font-size: 9px;
                        padding: 3px 8px;
                        border-radius: 4px;
                        margin-left: 10px;
                        font-weight: 900;
                        cursor: pointer;
                        box-shadow: 0 4px 12px rgba(124,58,237,0.4);
                        letter-spacing: 0.5px;
                    }
                    .ai-row-action:hover {
                        background: #6d28d9;
                        transform: translateY(-1px);
                    }
                </style>
            `;

            const injectionScript = `
                <script class="ai-script">
                    window.__AVAILABLE_FIXES = ${JSON.stringify(availableFixes)};
                    console.log("[COREWATCH] Injected " + window.__AVAILABLE_FIXES.length + " fixes. [v2.3]");

                    function injectAI() {
                        console.log("[IFRAME] Running injectAI probe...");
                        const audits = document.querySelectorAll('.lh-audit');
                        let badgeCount = 0;
                        const fixes = window.__AVAILABLE_FIXES || [];

                        audits.forEach(audit => {
                            const titleEl = audit.querySelector('.lh-audit__title');
                            if (!titleEl) return;
                            
                            const auditId = audit.id || '';
                            const hasDirectFix = fixes.some(f => f.linkedAuditId === auditId);
                            const tableUrls = Array.from(audit.querySelectorAll('.lh-text--url, .lh-url, a'))
                                .map(el => el.textContent.trim() || el.href)
                                .filter(u => u && u.length > 5);
                            
                            const hasTableFix = tableUrls.some(urlStr => {
                                return fixes.some(fix => {
                                    const target = fix.targetAsset?.trim();
                                    return target && urlStr.includes(target);
                                });
                            });

                            if (hasDirectFix || hasTableFix) {
                                if (!titleEl.querySelector('.ai-badge-injector')) {
                                    const badge = document.createElement('button');
                                    badge.className = 'ai-badge-injector';
                                    badge.innerHTML = '⚡ Fix with AI';
                                    badge.style.border = 'none';
                                    badge.style.cursor = 'pointer';
                                    titleEl.appendChild(badge);
                                    badgeCount++;
                                }
                            }

                            // 2. Table Row Suggestion Buttons
                            const tables = audit.querySelectorAll('table.lh-table, .lh-details');
                            tables.forEach(table => {
                                const cells = table.querySelectorAll('.lh-text--url, .lh-table-column--url, .lh-url, a');
                                cells.forEach(cell => {
                                    if (cell.querySelector('.ai-row-action')) return;
                                    
                                    let urlStr = cell.textContent.trim();
                                    const link = cell.querySelector('a') || (cell.tagName === 'A' ? cell : null);
                                    if (link && link.href) urlStr = link.href;

                                    if (!urlStr || urlStr.length < 5) return;
                                    
                                    const matchingFix = fixes.find(fix => {
                                        const target = fix.targetAsset?.trim();
                                        const filename = fix.filePath?.split('/').pop();
                                        if (target && urlStr.includes(target)) return true;
                                        if (filename && urlStr.includes(filename)) return true;
                                        return false;
                                    });

                                    if (matchingFix) {
                                        const btn = document.createElement('button');
                                        btn.className = 'ai-row-action';
                                        btn.dataset.fixId = matchingFix.id;
                                        btn.dataset.url = urlStr;
                                        btn.innerHTML = '✨ AI SUGGESTION [v2.4]';
                                        btn.style.marginLeft = '8px';
                                        cell.appendChild(btn);
                                    }
                                });
                            });
                        });
                        console.log("[IFRAME] Probe complete. Found " + badgeCount + " badges.");
                    }

                    // Global Event Delegation for Clicks
                    document.addEventListener('click', function(e) {
                        const badgeTrigger = e.target.closest('.ai-badge-injector');
                        const rowTrigger = e.target.closest('.ai-row-action');
                        
                        function sendSignal(data) {
                            console.log('[IFRAME/SHADOW] Dispatching Signal:', data);
                            const signal = new CustomEvent('lighthouse-signal', { 
                                detail: data,
                                bubbles: true, 
                                composed: true 
                            });
                            document.dispatchEvent(signal);
                            if (window.parent !== window) {
                                window.parent.postMessage(data, '*');
                            }
                        }

                        if (badgeTrigger) {
                            e.preventDefault();
                            e.stopPropagation();
                            sendSignal({ type: 'NAVIGATE_TO_FIXES' });
                        } else if (rowTrigger) {
                            e.preventDefault();
                            e.stopPropagation();
                            const fixId = rowTrigger.dataset.fixId;
                            const url = rowTrigger.dataset.url;
                            sendSignal({ type: 'OPEN_FIX', fixId: fixId, url: url });
                        }
                    }, true); // Use capture phase

                    // Initial Run
                    if (document.readyState === 'complete') injectAI();
                    else window.addEventListener('load', injectAI);

                    // Reactive Run for dynamic content
                    const observer = new MutationObserver((mutations) => {
                        observer.disconnect();
                        injectAI();
                        observer.observe(document.body, { childList: true, subtree: true });
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                </script>
            `;

            data.html = htmlReport.replace('</head>', customStyles + injectionScript + '</head>');
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
