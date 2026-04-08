"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import {
  Laptop,
  Smartphone,
  Search,
  Info,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Zap,
  Layout,
  UserCheck,
  Search as SearchIcon,
  X,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Activity,
  Bot,
  Wand2,
  Download,
  ClipboardCheck,
  Sparkle,
  Settings,
  ShieldCheck,
  History,
  Code,
  GitBranch,
  CloudUpload,
  Layers,
  FileCode,
  Upload,
  Eye,
  FileSearch,
  Maximize2,
  ListRestart,
  MousePointer2,
  MousePointerClick,
  Loader2,
  Terminal,
  Cpu,
  ZapOff,
  Clock,
  Edit3,
  Copy,
  Clipboard,
} from "lucide-react";
import styles from "./page.module.css";

interface Opportunity { id: string; nodeId: string; title: string; description: string; score: number; displayValue: string; savings: number; details: any; warnings?: string[]; }
interface Diagnostic { id: string; nodeId: string; title: string; description: string; displayValue: string; score?: number | null; details?: any; warnings?: string[]; }
interface FieldMetric {
  label: string;
  value: string;
  status: string;
  distributions: { min: number; max?: number; proportion: number; color: string; }[];
}
interface FilmstripItem { data: string; timing: number; }
interface AnalysisResult {
  html: string;
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number; pwa?: number; };
  metrics: { fcp: string; lcp: string; tbt: string; cls: string; si: string; tti: string; };
  opportunities: Opportunity[];
  diagnostics: Diagnostic[];
  passedCount: number;
  filmstrip: FilmstripItem[];
  url: string;
  device: string;
  fetchTime: string;
  fieldData?: {
    metrics: FieldMetric[];
    passed: boolean;
    hasData: boolean;
  };
}


export default function AutoDeployDashboard() {
  const [url, setUrl] = useState("");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullReport, setShowFullReport] = useState(false);
  const [globalFixes, setGlobalFixes] = useState<{ executiveSummary: string, fixes: any[] } | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [fixesIdentified, setFixesIdentified] = useState(false);
  const [fixLog, setFixLog] = useState<any[]>([]);
  const [countdown, setCountdown] = useState(0);

  const [activeTab, setActiveTab] = useState<"dashboard" | "lighthouse">("lighthouse");
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [activeSteps, setActiveSteps] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [showUnitReview, setShowUnitReview] = useState(false);
  const [unitReviewLoading, setUnitReviewLoading] = useState(false);
  const [unitData, setUnitData] = useState<any>(null);
  const [diffData, setDiffData] = useState<{ old: string, new: string, fileName: string, status?: string } | null>(null);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLoading, setDiffLoading] = useState(false);
  const [pushLoading, setPushLoading] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (loading || unitReviewLoading || pushLoading) {
      if (countdown === 0) setCountdown(0);
      timer = setInterval(() => setCountdown(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [loading, unitReviewLoading, pushLoading]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = event.data;
      if (typeof data !== 'object' || data === null) return;

      console.log(`[DASHBOARD] Signal: ${data.type}`);

      if (data.type === 'OPEN_FIX') {
        const { fixId, url } = data;
        const fixes = globalFixes?.fixes || [];
        let fix = fixes.find((f: any) => f.id === fixId);
        if (!fix && url) {
          fix = fixes.find((f: any) => (f.targetAsset || "").toLowerCase().includes(url.toLowerCase()));
        }
        if (fix) {
          setUnitData({
            id: fix.id,
            fileChanged: fix.filePath,
            impact: fix.impact + " strategy applied to " + fix.targetAsset,
            originalSnippet: fix.originalSnippet,
            fixedSnippet: fix.fixedSnippet,
            riskLevel: fix.riskLevel,
            isBreaking: fix.isBreaking,
            source: 'ai'
          });
          setShowUnitReview(true);
        }
      } else if (data.type === 'NAVIGATE_TO_FIXES' || data.type === 'SWITCH_TAB') {
        console.log('[DASHBOARD] Triggering automated tab transition...');
        setTimeout(() => {
          setActiveTab('dashboard');
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }, 10);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [globalFixes]);

  const handleSyncFixes = async () => {
    try {
      const res = await fetch('/api/load-fixes');
      const data = await res.json();
      if (data.ready) {
        setGlobalFixes(data);
        setFixesIdentified(true);
      }
    } catch (err) {
      console.error("Failed to sync manifest:", err);
    }
  };

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setResult(null);
    setGlobalError(null);
    setFixesIdentified(false);
    setIsOrchestrated(false);
    setActiveSteps(["Initializing Antigravity probe...", "Waking up performance agents..."]);

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, device }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Analysis failed");

      const mapped = mapLighthouseResult(data, url, device);
      setResult(mapped);
      setFixesIdentified(true);
      handleLoadFixes();
    } catch (err: any) {
      setError(err.message);
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadFixes = async () => {
    setGlobalLoading(true);
    try {
      const res = await fetch("/api/load-fixes");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setGlobalFixes(data);
    } catch (err: any) {
      setGlobalError("__PENDING__");
    } finally {
      setGlobalLoading(false);
    }
  };

  const [showPromptModal, setShowPromptModal] = useState(false);
  const [activePrompt, setActivePrompt] = useState<any>(null);

  const handleOpenPromptModal = (nodeId: string, title: string, itemOrItems: any) => {
    const isBatch = Array.isArray(itemOrItems);
    let promptText = "";
    let resourceLabel = "";

    if (isBatch) {
      const targets = itemOrItems.map((item: any, idx: number) => {
        const rowId = `${nodeId}-${(idx + 1).toString().padStart(2, '0')}`;
        return `${rowId}: ${item.url || item.text || item.label || "Resource"}`;
      }).join("\n");

      resourceLabel = `${itemOrItems.length} resources in category`;
      promptText = `--- COREWATCH BATCH MISSION ---
CATEGORY ID: ${nodeId}
ISSUE: ${title}

TARGETS TO OPTIMIZE:
${targets}

TASK: Generate individual surgical patches for EVERY asset listed above.
FORMAT: Return output ONLY as a JSON ARRAY [...] suitable for merging into 'generated-fixes.json'.
EACH ITEM KEYS: id, title, explanation, filePath, targetAsset, originalSnippet, fixedSnippet, linkedNodeId (matching the specific Row ID).`;
    } else {
      const resource = itemOrItems.url || itemOrItems.text || itemOrItems.label || "General Resource";
      resourceLabel = resource;
      promptText = `--- COREWATCH PERF MISSION ---
ID: ${nodeId}
Issue Type: ${title}
Specific Resource: ${resource}
Task: Review ONLY this specific asset and generate a surgical performance fix. 
Format: Return output ONLY as a JSON object suitable for 'generated-fixes.json'.
Keys: id, title, explanation, filePath, targetAsset, originalSnippet, fixedSnippet, linkedNodeId (set to '${nodeId}').`;
    }

    setActivePrompt({ nodeId, title, resource: resourceLabel, promptText, isBatch, count: isBatch ? itemOrItems.length : 1 });
    setShowPromptModal(true);
  };

  const handleApplyGlobalFix = (fix: any) => {
    setUnitData({
      id: fix.id,
      fileChanged: fix.filePath,
      impact: fix.impact + " strategy applied to " + (fix.targetAsset || "Main-Thread"),
      originalSnippet: fix.originalSnippet,
      fixedSnippet: fix.fixedSnippet,
      riskLevel: fix.riskLevel,
      isBreaking: fix.isBreaking,
      source: 'ai'
    });
    setShowUnitReview(true);
  };

  const handleApplyUnitFix = async () => {
    if (!unitData) return;
    setPushLoading(unitData.id);
    setActiveSteps(["Syncing patch to Shopify network...", "Bypassing content cache..."]);
    try {
      const response = await fetch("/api/apply-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fixId: unitData.id,
          originalSnippet: unitData.originalSnippet,
          fixedSnippet: unitData.fixedSnippet,
          filePath: unitData.fileChanged
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      alert("✅ Fix Applied Successfully!");
      setShowUnitReview(false);
    } catch (e: any) {
      alert("Failed: " + e.message);
    } finally {
      setPushLoading(null);
      setActiveSteps([]);
    }
  };

  const handleBatchApplyLowRisk = async () => {
    const lowRiskFixes = globalFixes?.fixes?.filter((f: any) => f.riskLevel === "Low") || [];
    if (lowRiskFixes.length === 0) return;
    setPushLoading('batch');
    let successCount = 0;
    for (const fix of lowRiskFixes) {
      try {
        await fetch("/api/apply-fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...fix, fixId: fix.id })
        });
        successCount++;
      } catch (e) { }
    }
    alert(`Applied ${successCount} low-risk optimizations.`);
    setPushLoading(null);
  };

  const handleLoadLastAudit = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/last-audit');
      const rawData = await res.json();
      setResult(mapLighthouseResult(rawData, rawData.lighthouseResult?.requestedUrl || "", "mobile"));
      handleLoadFixes();
    } catch (err: any) {
      alert("No cached audit found.");
    } finally {
      setLoading(false);
    }
  };

  const [isOrchestrated, setIsOrchestrated] = useState(false);

  const deterministicGetNodeId = (auditId: string) => {
    const stableMap: Record<string, string> = {
      'unminified-javascript': 'CW-PERF-101',
      'unused-javascript': 'CW-PERF-102',
      'unminified-css': 'CW-PERF-201',
      'unused-css': 'CW-PERF-202',
      'offscreen-images': 'CW-PERF-301',
      'modern-image-formats': 'CW-PERF-302',
      'uses-responsive-images': 'CW-PERF-303',
      'efficient-animated-content': 'CW-PERF-304',
      'duplicated-javascript': 'CW-PERF-103',
      'legacy-javascript': 'CW-PERF-104',
      'mainthread-work-breakdown': 'CW-PERF-901',
      'bootup-time': 'CW-PERF-902',
      'uses-rel-preload': 'CW-PERF-401',
      'uses-rel-preconnect': 'CW-PERF-402',
      'font-display': 'CW-PERF-403',
      'render-blocking-resources': 'CW-PERF-501',
      'total-byte-weight': 'CW-PERF-601',
    };

    if (stableMap[auditId]) return stableMap[auditId];

    // Fallback: Generate a stable semi-numeric ID from the hash of the audit string if not in core map
    let hash = 0;
    for (let i = 0; i < auditId.length; i++) {
      hash = ((hash << 5) - hash) + auditId.charCodeAt(i);
      hash |= 0;
    }
    const numericHash = Math.abs(hash % 1000).toString().padStart(3, '0');
    return `CW-PERF-EXT-${numericHash}`;
  };

  const mapLighthouseResult = (rawData: any, url: string, device: string): AnalysisResult => {
    const reportJson = rawData.lighthouseResult || {};
    const audits = reportJson.audits || {};
    const categories = reportJson.categories || {};

    const extractMetric = (id: string) => audits[id]?.displayValue || "--";

    return {
      html: rawData.html || rawData.htmlReport || "",
      scores: {
        performance: Math.round((categories.performance?.score || 0) * 100),
        accessibility: Math.round((categories.accessibility?.score || 0) * 100),
        bestPractices: Math.round((categories["best-practices"]?.score || 0) * 100),
        seo: Math.round((categories.seo?.score || 0) * 100),
      },
      metrics: {
        fcp: extractMetric("first-contentful-paint"),
        lcp: extractMetric("largest-contentful-paint"),
        tbt: extractMetric("total-blocking-time"),
        cls: extractMetric("cumulative-layout-shift"),
        si: extractMetric("speed-index"),
        tti: extractMetric("interactive"),
      },
      passedCount: Object.values(audits).filter((a: any) => a && a.score === 1).length,
      filmstrip: audits["screenshot-thumbnails"]?.details?.items?.map((item: any) => ({ data: item.data, timing: item.timing })) || [],
      opportunities: Object.values(audits)
        .filter((a: any) => a && a.details?.type === "opportunity" && a.score < 1)
        .map((a: any) => ({
          id: a.id,
          nodeId: deterministicGetNodeId(a.id),
          title: a.title,
          description: a.description,
          score: a.score,
          displayValue: a.displayValue,
          savings: a.details?.overallSavingsMs,
          details: a.details
        })),
      diagnostics: Object.values(audits)
        .filter((a: any) => a && a.score !== null && a.score < 1 && a.details?.type !== "opportunity")
        .map((a: any) => ({
          id: a.id,
          nodeId: deterministicGetNodeId(a.id),
          title: a.title,
          description: a.description,
          score: a.score,
          displayValue: a.displayValue,
          details: a.details
        })),
      url: url || "",
      device: device || "mobile",
      fetchTime: reportJson.fetchTime || new Date().toISOString()
    };
  };

  return (
    <main className={styles.container}>
      <header className={styles.header}><div className={styles.logo}>CORE<span>WATCH</span> AUTO</div></header>

      <section className={styles.searchSection}>
        <div className={styles.inputContainer + " glass-card"}>
          <div className={styles.deviceSelector}><button className={device === "mobile" ? styles.active : ""} onClick={() => setDevice("mobile")}><Smartphone size={18} /> Mobile</button><button className={device === "desktop" ? styles.active : ""} onClick={() => setDevice("desktop")}><Laptop size={18} /> Desktop</button></div>
          <form className={styles.searchForm} onSubmit={handleAnalyze}>
            <input type="text" placeholder="Landing Page URL" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" disabled={loading} className={styles.analyzeBtn}>{loading ? "Analyzing..." : "Analyze"}</button>
            <button type="button" onClick={handleLoadLastAudit} disabled={loading} className={styles.fullReportBtn}><History size={16} /> Load Last</button>
          </form>
        </div>
      </section>

      {result && (
        <section className={styles.resultContainer}>
          <div className={styles.resultHeader}>
            <div className={styles.tabSwitcher}>
              <button className={activeTab === 'dashboard' ? styles.activeTab : ""} onClick={() => setActiveTab('dashboard')}><Zap size={16} /> AI Suggestions</button>
              <button className={activeTab === 'lighthouse' ? styles.activeTab : ""} onClick={() => setActiveTab('lighthouse')}><Eye size={16} /> Full Report</button>
              {result && (
                <button className={styles.syncBtn} onClick={handleSyncFixes} title="Sync latest fixes from manifest">
                  <RefreshCw size={14} />
                </button>
              )}
              {result && !isOrchestrated && (
                <button className={styles.orchestrateBtn} onClick={() => { setIsOrchestrated(true); handleSyncFixes(); }}>
                  <Wand2 size={16} /> Finalize AI Mission IDs
                </button>
              )}
            </div>
          </div>

          {activeTab === 'lighthouse' ? (
            <div className={styles.insightsView}>
              <div className={styles.gridScores}>
                <ScoreCircle title="Performance" score={result.scores.performance} icon={<Zap size={14} />} />
                <ScoreCircle title="Access" score={result.scores.accessibility} icon={<UserCheck size={14} />} />
                <ScoreCircle title="Best Practices" score={result.scores.bestPractices} icon={<ShieldCheck size={14} />} />
                <ScoreCircle title="SEO" score={result.scores.seo} icon={<SearchIcon size={14} />} />
              </div>

              <div className={styles.suggestionSection}>
                <h3>All Performance Audits</h3>
                <div className={styles.suggestionList}>
                  {result.opportunities.map(opp => (
                    <SuggestionItem
                      key={opp.id}
                      nodeId={opp.nodeId}
                      title={opp.title}
                      score={opp.score}
                      savings={opp.displayValue}
                      desc={opp.description}
                      details={opp.details}
                      fixes={globalFixes?.fixes || []}
                      onApplyAiFix={handleApplyGlobalFix}
                      onOpenPrompt={handleOpenPromptModal}
                      isOrchestrated={isOrchestrated}
                    />
                  ))}
                  {result.diagnostics.map(diag => (
                    <SuggestionItem
                      key={diag.id}
                      nodeId={diag.nodeId}
                      title={diag.title}
                      score={diag.score}
                      savings={diag.displayValue}
                      desc={diag.description}
                      details={diag.details}
                      fixes={globalFixes?.fixes || []}
                      onApplyAiFix={handleApplyGlobalFix}
                      onOpenPrompt={handleOpenPromptModal}
                      isOrchestrated={isOrchestrated}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.insightsView}>
              <div className={styles.gridScores}>
                <ScoreCircle title="Performance" score={result.scores.performance} icon={<Zap size={14} />} />
                <ScoreCircle title="Access" score={result.scores.accessibility} icon={<UserCheck size={14} />} />
              </div>

              {globalFixes && (
                <div className={styles.globalPlanSection + " glass-card"}>
                  <div className={styles.globalHeader}>
                    <h3>Antigravity Global Optimization Plan</h3>
                    <p>{globalFixes.executiveSummary}</p>
                    <button className={styles.batchBtn} onClick={handleBatchApplyLowRisk}>Batch Apply Low Risk</button>
                  </div>
                  <div className={styles.globalFixList}>
                    {globalFixes.fixes.map((fix, i) => (
                      <div key={i} className={styles.globalFixItem + " glass-card"}>
                        <div className={styles.fixInfo}>
                          <h4>{fix.title}</h4>
                          <p>{fix.explanation}</p>
                          <code className={styles.fixPath}>{fix.filePath} (Target: {fix.targetAsset})</code>
                        </div>
                        <button className={styles.reviewFixBtn} onClick={() => handleApplyGlobalFix(fix)}>Review Fix <Sparkle size={14} /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.suggestionSection}>
                <h3>Opportunities</h3>
                <div className={styles.suggestionList}>
                  {result.opportunities.map(opp => (
                    <SuggestionItem
                      key={opp.id}
                      nodeId={opp.nodeId}
                      title={opp.title}
                      score={opp.score}
                      savings={opp.displayValue}
                      desc={opp.description}
                      details={opp.details}
                      fixes={globalFixes?.fixes || []}
                      onApplyAiFix={handleApplyGlobalFix}
                      onOpenPrompt={handleOpenPromptModal}
                      isOrchestrated={isOrchestrated}
                    />
                  ))}
                </div>
              </div>

              <div className={styles.suggestionSection}>
                <h3>Diagnostics</h3>
                <div className={styles.suggestionList}>
                  {result.diagnostics.map(diag => (
                    <SuggestionItem
                      key={diag.id}
                      nodeId={diag.nodeId}
                      title={diag.title}
                      score={diag.score}
                      savings={diag.displayValue}
                      desc={diag.description}
                      details={diag.details}
                      fixes={globalFixes?.fixes || []}
                      onApplyAiFix={handleApplyGlobalFix}
                      onOpenPrompt={handleOpenPromptModal}
                      isOrchestrated={isOrchestrated}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {showUnitReview && unitData && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}><h3>Review Fix: {unitData.fileChanged}</h3><button onClick={() => setShowUnitReview(false)}><X size={24} /></button></div>
            <div className={styles.diffContainer}>
              <ReactDiffViewer oldValue={unitData.originalSnippet} newValue={unitData.fixedSnippet} splitView={true} useDarkTheme={true} />
            </div>
            <div className={styles.unitFooter}>
              <button className={styles.applyUnitBtn} onClick={handleApplyUnitFix} disabled={!!pushLoading}>
                {pushLoading === unitData.id ? "Syncing..." : "Apply Optimization"}
              </button>
            </div>
          </div>
        </div>
      )}
      {showPromptModal && activePrompt && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent}>
            <div className={styles.modalHeader}>
              <h3>{activePrompt.isBatch ? "Batch AI Mission" : "AI Mission"}: {activePrompt.nodeId}</h3>
              <button onClick={() => setShowPromptModal(false)}><X size={24} /></button>
            </div>
            <div className={styles.promptWorkspace}>
              <div className={styles.promptContext}>
                <div className={styles.contextItem}><strong>{activePrompt.isBatch ? "Batch Scope:" : "Target Resource:"}</strong> <span>{activePrompt.resource}</span></div>
                <div className={styles.contextItem}><strong>Issue Strategy:</strong> <span>{activePrompt.title}</span></div>
              </div>
              <div className={styles.promptBox}>
                <div className={styles.promptBoxHeader}>
                  <span>ORCHESTRATED {activePrompt.isBatch ? "BATCH" : ""} PROMPT</span>
                  <button onClick={() => { navigator.clipboard.writeText(activePrompt.promptText); alert("Orchestrated prompt copied!"); }}>
                    <Copy size={14} /> Copy Mission Brief
                  </button>
                </div>
                <pre>{activePrompt.promptText}</pre>
              </div>
              <p className={styles.promptHint}>
                {activePrompt.isBatch
                  ? "Paste this into your AI to generate a collective FIX ARRAY for all sub-issues in this category."
                  : "Paste this prompt into Antigravity or your AI of choice to generate the surgical fix JSON."}
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function AuditDetailTable({ details, parentNodeId, fixes, onApplyAiFix, onOpenPrompt, isOrchestrated }: { details: any, parentNodeId: string, fixes: any[], onApplyAiFix: any, onOpenPrompt: any, isOrchestrated: boolean }) {
  if (!details || !details.headings || !details.items) return null;
  if (details.type !== 'table' && details.type !== 'opportunity') return null;

  return (
    <div className={styles.auditTableWrapper}>
      <table className={styles.auditTable}>
        <thead>
          <tr>
            <th style={{ width: '100px' }}>ID</th>
            {details.headings.map((h: any, i: number) => (
              <th key={i}>{h.text || h.key}</th>
            ))}
            <th style={{ width: '120px' }}>AI OPTIMIZATION</th>
          </tr>
        </thead>
        <tbody>
          {details.items.map((item: any, rid: number) => {
            const rowNodeId = `${parentNodeId}-${(rid + 1).toString().padStart(2, '0')}`;
            const existingFix = fixes?.find(f => f.linkedNodeId === rowNodeId);

            return (
              <tr key={rid}>
                <td><span className={styles.granularIdCell}>{rowNodeId}</span></td>
                {details.headings.map((h: any, cid: number) => {
                  const raw = item[h.key];
                  const isUrl = h.valueType === 'url' || h.key === 'url';
                  const isNumeric = h.valueType === 'bytes' || h.valueType === 'timespanMs' || typeof raw === 'number';
                  let val = raw;
                  if (raw && typeof raw === 'object') val = raw.url || raw.text || JSON.stringify(raw);

                  return (
                    <td key={cid} className={isUrl ? styles.urlCell : isNumeric ? styles.kbCell : ""}>
                      {isNumeric && typeof raw === 'number' ? (raw > 1024 ? (raw / 1024).toFixed(1) + ' KB' : raw.toFixed(0)) : val}
                    </td>
                  );
                })}
                <td>
                  {!isOrchestrated ? (
                    <span className={styles.pendingBadge}>PENDING</span>
                  ) : existingFix ? (
                    <button className={styles.miniReviewBtn} onClick={() => onApplyAiFix(existingFix)}>
                      🔍 Review Fix
                    </button>
                  ) : (
                    <button className={styles.miniPromptBtn} onClick={() => onOpenPrompt(rowNodeId, details.title || "Audit", item)}>
                      ⚡ Fix Asset
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SuggestionItem({ title, savings, score, desc, details, nodeId, fixes, onApplyAiFix, onOpenPrompt, isOrchestrated }: any) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className={styles.suggestionItem}>
      <div className={styles.suggestionMain} onClick={() => setIsOpen(!isOpen)}>
        <div className={styles.auditIndicator}>
          {score >= 0.9 ? <div className={styles.passMarker} title="Passed" /> :
            score >= 0.5 ? <div className={styles.averageMarker} title="Average" /> :
              <div className={styles.failMarker} title="Failed" />}
        </div>
        <div className={styles.suggestionHeaderInfo}>
          <div className={styles.titleWithNode}>
            <span className={styles.nodeIdBadge}>{isOrchestrated ? nodeId : "???"}</span>
            <h4>{title}</h4>
          </div>
          {savings && <span className={styles.savingsBadge}>{savings}</span>}
        </div>
        <div className={styles.suggestionActions}>
          {isOrchestrated && (
            <button
              className={styles.aiFixBadgeBtn}
              onClick={(e) => { e.stopPropagation(); onOpenPrompt(nodeId, title, details?.items || []); }}
              style={{ fontSize: '10px', padding: '4px 8px' }}
            >
              ⚡ Fix All Assets
            </button>
          )}
          <ChevronDown size={14} style={{ opacity: 0.5, transform: isOpen ? 'rotate(180deg)' : '' }} />
        </div>
      </div>
      {isOpen && (
        <div className={styles.suggestionDetails}>
          <div className={styles.suggestionDesc} dangerouslySetInnerHTML={{ __html: desc }} />
          <AuditDetailTable details={details} parentNodeId={nodeId} fixes={fixes} onApplyAiFix={onApplyAiFix} onOpenPrompt={onOpenPrompt} isOrchestrated={isOrchestrated} />
        </div>
      )}
    </div>
  );
}

const ScoreCircle = ({ title, score, icon }: any) => {
  const color = score >= 90 ? '#0cce6b' : score >= 50 ? '#ffa400' : '#ff4e42';
  return (
    <div className={styles.scoreBox}>
      <div className={styles.scoreCircle} style={{ borderColor: color }}>
        <span style={{ color }}>{score}</span>
      </div>
      <div className={styles.scoreTitle}>{icon} {title}</div>
    </div>
  );
};
