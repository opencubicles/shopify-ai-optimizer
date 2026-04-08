"use client";

import React, { useState, useEffect, useMemo } from "react";
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
} from "lucide-react";
import styles from "./page.module.css";

interface Opportunity { id: string; title: string; description: string; score: number; displayValue: string; savings: number; details: any; warnings?: string[]; }
interface Diagnostic { id: string; title: string; description: string; displayValue: string; score?: number | null; details?: any; warnings?: string[]; }
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

  // Tabs: dashboard | lighthouse
  const [activeTab, setActiveTab] = useState<"dashboard" | "lighthouse">("lighthouse");

  // Auto-Deploy Switch
  const [autoDeploy, setAutoDeploy] = useState(true);

  // Status/Steps state
  const [activeSteps, setActiveSteps] = useState<string[]>([]);
  const [currentAction, setCurrentAction] = useState<string | null>(null);

  // Unit Review State
  const [showUnitReview, setShowUnitReview] = useState(false);
  const [unitReviewLoading, setUnitReviewLoading] = useState(false);
  const [unitData, setUnitData] = useState<any>(null);

  // History Diff State
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

  const handleAnalyze = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setLoading(true);
    setResult(null);
    setGlobalFixes(null);
    setGlobalError(null);
    setFixesIdentified(false);
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
        .map((a: any) => ({ id: a.id, title: a.title, description: a.description, score: a.score, displayValue: a.displayValue, savings: a.details?.overallSavingsMs, details: a.details })),
      diagnostics: Object.values(audits)
        .filter((a: any) => a && a.score !== null && a.score < 1 && a.details?.type !== "opportunity")
        .map((a: any) => ({ id: a.id, title: a.title, description: a.description, displayValue: a.displayValue, score: a.score, details: a.details })),
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
            </div>
          </div>

          {activeTab === 'lighthouse' ? (
            <div className={styles.lighthouseFrameWrapper}><iframe srcDoc={result.html} className={styles.lighthouseFrame} /></div>
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
                      title={opp.title}
                      savings={opp.displayValue}
                      impact="High"
                      desc={opp.description}
                      aiFix={globalFixes?.fixes?.find(f => f.linkedAuditId === opp.id)}
                      onApplyAiFix={handleApplyGlobalFix}
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
                      title={diag.title}
                      savings={diag.displayValue}
                      impact="Medium"
                      desc={diag.description}
                      aiFix={globalFixes?.fixes?.find(f => f.linkedAuditId === diag.id)}
                      onApplyAiFix={handleApplyGlobalFix}
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
    </main>
  );
}

function ScoreCircle({ title, score, icon }: any) {
  return (<div className={styles.scoreBox}><div className={styles.scoreText}>{score}</div><div className={styles.scoreTitle}>{icon} {title}</div></div>);
}

function SuggestionItem({ title, savings, impact, desc, aiFix, onApplyAiFix }: any) {
  return (
    <div className={styles.suggestionItem + " glass-card"}>
      <div className={styles.suggestionMain}>
        <div className={styles.suggestionHeaderInfo}>
          <h4>{title}</h4>
          <span className={styles.savingsBadge}>{savings}</span>
        </div>
        <p>{desc}</p>
        {aiFix && (
          <button className={styles.aiFixBadgeBtn} onClick={() => onApplyAiFix(aiFix)}>
            <Zap size={12} /> AI FIX AVAILABLE: {aiFix.title}
          </button>
        )}
      </div>
    </div>
  );
}
