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
  ZapOff
} from "lucide-react";
import styles from "./page.module.css";

interface Opportunity { id: string; title: string; description: string; score: number; displayValue: string; savings: number; details: any; }
interface Diagnostic { id: string; title: string; description: string; displayValue: string; }
interface AnalysisResult { html: string; scores: { performance: number; accessibility: number; bestPractices: number; seo: number; }; metrics: { fcp: string; lcp: string; tbt: string; cls: string; si: string; tti: string; }; opportunities: Opportunity[]; diagnostics: Diagnostic[]; url: string; device: string; fetchTime: string; }

export default function AutoDeployDashboard() {
  const [url, setUrl] = useState("");
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullReport, setShowFullReport] = useState(false);

  const [fixesIdentified, setFixesIdentified] = useState(false);
  const [fixLog, setFixLog] = useState<any[]>([]);
  const [countdown, setCountdown] = useState(0);

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

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (loading || unitReviewLoading || pushLoading) {
      if (countdown === 0) setCountdown(0);
      timer = setInterval(() => setCountdown(prev => prev + 1), 1000);
    }
    return () => clearInterval(timer);
  }, [loading, unitReviewLoading, pushLoading]);

  const handleAnalyze = async (e?: React.FormEvent) => {
    e?.preventDefault(); if (!url) return;
    setLoading(true); setError(null); setResult(null); setFixesIdentified(false);
    setActiveSteps(["Connecting to Lighthouse CLI...", "Auditing Performance Metrics...", "Extrating Diagnostics..."]);
    setCurrentAction("Full Audit Execution");
    try {
      const response = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url, device }) });
      if (!response.ok) throw new Error("Analysis failed");
      const data = await response.json();
      setResult(data);
      setFixesIdentified(true);
    } catch (err: any) { setError(err.message); } finally { setLoading(false); setActiveSteps([]); setCurrentAction(null); }
  };

  const handleIdentityUnitFix = async (issue: any) => {
    if (!result) return;
    setUnitReviewLoading(true);
    setShowUnitReview(true);
    setUnitData(null);
    setActiveSteps(["Scanning theme directory...", "Mapping PageSpeed URLs to theme files...", "Architecting surgical fix..."]);
    setCurrentAction("AI Analysis");
    try {
      const response = await fetch("/api/apply-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: result.url, issueId: issue.id, title: issue.title, details: issue.details, device: result.device, previewOnly: true
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Failed to identify unit fix");
      setUnitData({ ...data, issue });
      setActiveSteps(data.steps || []);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
      setShowUnitReview(false);
    } finally {
      setUnitReviewLoading(false);
    }
  };

  const handleApplyUnitFix = async () => {
    if (!unitData) return;
    setUnitReviewLoading(true);
    setActiveSteps(["Verification of code snippet uniqueness...", "Applying atomic patch to local file...", "Updating session logs..."]);

    try {
      const response = await fetch("/api/apply-fix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: result?.url, issueId: unitData.details?.issueId, title: unitData.title, details: unitData.details, device, previewOnly: false
        })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Failed to apply fix");

      setFixLog(prev => [data, ...prev]);

      // AUTO DEPLOY LOGIC 🚀
      if (autoDeploy) {
        setActiveSteps([...(data.steps || []), "Auto-Deploying to Shopify Theme..."]);
        setCurrentAction("Live Deployment");
        const pushRes = await fetch("/api/theme-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath: data.fileChanged }) });
        const pushData = await pushRes.json();
        if (!pushRes.ok) throw new Error(pushData.detail || "Auto-Deploy failed");
        setActiveSteps(pushData.steps || []);
        alert(`✅ Optimization Applied & Deployed to Shopify!`);
      } else {
        alert(`✅ Optimization Applied to Disk. Manually push when ready.`);
      }

      setShowUnitReview(false);
    } catch (err: any) { alert(`Error: ${err.message}`); } finally { setUnitReviewLoading(false); setActiveSteps([]); setCurrentAction(null); }
  };

  const handlePushToShopify = async (filePath?: string) => {
    if (!window.confirm(filePath ? `Push ${filePath} to Theme?` : "Confirm entire theme sync?")) return;
    setPushLoading(filePath || "all");
    setActiveSteps(["Staging local improvements (git add)...", "Securing version history (git commit)...", "Syncing to Shopify Theme ID..."]);
    setCurrentAction("Shopify Deployment");
    try {
      const response = await fetch("/api/theme-push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || "Push failed");
      setActiveSteps(data.steps || []);
      alert(`✅ Shopify Sync Success: ${data.message}`);
    } catch (err: any) { alert(`❌ Push Error: ${err.message}`); } finally { setPushLoading(null); setActiveSteps([]); setCurrentAction(null); }
  };

  const handleShowDiffViewer = async (filePath: string) => {
    setDiffLoading(true); setShowDiff(true); setDiffData(null);
    try {
      const response = await fetch("/api/diff-data", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ filePath }) });
      const data = await response.json();
      setDiffData({ old: data.oldCode, new: data.newCode, fileName: data.fileName, status: data.status });
    } catch (e) { alert("Failed to load diff."); } finally { setDiffLoading(false); }
  };

  return (
    <main className={styles.container}>
      <div className={styles.subtleBg}></div>
      <header className={styles.header}><div className={styles.logo}>CORE<span>WATCH</span> AUTO</div><div className={styles.headerRight}><div className={styles.headerLinks}><a href="#">Docs</a></div><button className={styles.loginBtn}>Sign In</button></div></header>

      <section className={styles.searchSection}>
        <div className={styles.heroText}><h1>Auto-Deploy <span>Optimizations.</span></h1><p>Confirm the code fix and watch it go live in seconds.</p></div>
        <div className={styles.inputContainer + " glass-card"}>
          <div className={styles.deviceSelector}><button className={device === "mobile" ? styles.active : ""} onClick={() => setDevice("mobile")}><Smartphone size={18} /> Mobile</button><button className={device === "desktop" ? styles.active : ""} onClick={() => setDevice("desktop")}><Laptop size={18} /> Desktop</button></div>
          <form className={styles.searchForm} onSubmit={handleAnalyze}><div className={styles.urlInputWrapper}><SearchIcon className={styles.searchIcon} size={20} /><input type="text" placeholder="Landing Page URL (use ?preview_theme_id for best results)" value={url} onChange={(e) => setUrl(e.target.value)} autoFocus /></div><button type="submit" disabled={loading} className={styles.analyzeBtn}>{loading ? <RefreshCw className={styles.spin} /> : "Analyze"}</button></form>
        </div>
      </section>

      {(loading || pushLoading) && (
        <section className={styles.loadingContainer + " animate-fade-in"}>
          <div className={styles.pulseContainer}><div className={styles.pulseCircle}></div><div className={styles.pulseCircle}></div><div className={styles.pulseCircle}></div></div>
          <div className={styles.statusBox + " glass-card"}>
            <div className={styles.statusHeader}><Terminal size={18} /> <span>{currentAction || "System Execution"} - {countdown}s</span></div>
            <div className={styles.stepsList}>
              {activeSteps.map((step, i) => (
                <div key={i} className={styles.stepItem}><CheckCircle2 size={14} color={i === activeSteps.length - 1 ? "var(--primary)" : "var(--success)"} /> {step}</div>
              ))}
              {loading || pushLoading ? <div className={styles.stepItem}><Loader2 className={styles.spin} size={14} /> Finalizing Shopify handshake...</div> : null}
            </div>
          </div>
          <div className={styles.loadingTrack}><div className={styles.loadingProgress}></div></div>
        </section>
      )}

      {result && !loading && !pushLoading && (
        <section className={styles.resultContainer + " animate-slide-up"}>
          <div className={styles.resultHeader}>
            <div className={styles.resultInfo}><h2><a href={result.url} target="_blank" rel="noreferrer">{result.url}</a></h2><span>{new Date(result.fetchTime).toLocaleString()} | {result.device.toUpperCase()}</span></div>
            <div className={styles.resultActions}><button className={styles.fullReportBtn} onClick={() => setShowFullReport(true)}>Report <ExternalLink size={16} /></button></div>
          </div>

          <div className={styles.gridScores}>
            <ScoreCircle title="Performance" score={result.scores.performance} icon={<Zap size={14} />} /><ScoreCircle title="Accessibility" score={result.scores.accessibility} icon={<UserCheck size={14} />} /><ScoreCircle title="Best Practices" score={result.scores.bestPractices} icon={<Layout size={14} />} /><ScoreCircle title="SEO" score={result.scores.seo} icon={<TrendingUp size={14} />} />
          </div>

          {fixLog.length > 0 && (
            <div className={styles.fixHistory + " glass-card animate-slide-up"}>
              <div className={styles.historyHeader}><div className={styles.historyTitleRow}><History size={18} color="var(--success)" /><h4>Precision Trace Log ({fixLog.length})</h4></div><button className={styles.pushBtn} onClick={() => handlePushToShopify()} disabled={pushLoading === "all"}>{pushLoading === "all" ? <Loader2 className={styles.spin} size={14} /> : <CloudUpload size={16} />} Sync All Changes</button></div>
              <div className={styles.historyList}>
                {fixLog.map((log, idx) => (
                  <div key={idx} className={styles.historyItem}><div className={styles.historyItemMain}><div className={styles.itemSubject}><span>✓ <strong>{log.fileChanged}</strong> updated.</span><small>{log.summary}</small></div><div className={styles.itemActions}><button className={styles.diffViewBtn} onClick={() => handleShowDiffViewer(log.fileChanged)}><FileSearch size={14} /> See Diff</button><button className={styles.targetedPushBtn} onClick={() => handlePushToShopify(log.fileChanged)} disabled={pushLoading === log.fileChanged}>{pushLoading === log.fileChanged ? <Loader2 className={styles.spin} size={12} /> : <Upload size={12} />} Re-Push Unit</button></div></div></div>
                ))}
              </div>
            </div>
          )}

          <div className={styles.metricsWrapper + " glass-card"}><h3>Key Metrics</h3><div className={styles.metricsGrid}><MetricCard title="First Contentful Paint" value={result.metrics.fcp} /><MetricCard title="Largest Contentful Paint" value={result.metrics.lcp} type="lcp" /><MetricCard title="Total Blocking Time" value={result.metrics.tbt} type="tbt" /><MetricCard title="Cumulative Layout Shift" value={result.metrics.cls} type="cls" /><MetricCard title="Speed Index" value={result.metrics.si} /><MetricCard title="Time to Interactive" value={result.metrics.tti} /></div></div>

          <div className={styles.suggestionSection}>
            <div className={styles.suggestionHeader}><TrendingUp size={24} color="var(--primary)" /><h3>Audit Opportunity Trace</h3><span className={styles.badge}>Live Action Engine</span></div>
            <div className={styles.suggestionList}>{result.opportunities.map(opp => <SuggestionItem key={opp.id} title={opp.title} savings={opp.displayValue} impact={opp.score < 0.5 ? "High" : "Medium"} desc={opp.description} canFix={fixesIdentified} onFix={() => handleIdentityUnitFix(opp)} />)}</div>
          </div>
        </section>
      )}

      {/* Unit Review Modal with Steps */}
      {showUnitReview && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent + " " + styles.diffCheckerModal}>
            <div className={styles.modalHeader}>
              <div className={styles.aiHeaderTitle}><Cpu size={24} color="var(--primary)" /><h3>Precision Fix: {unitData?.fileChanged || "Targeting Asset..."}</h3></div>
              <div className={styles.diffLabels}><div className={styles.labelOld}>Current</div><ArrowRight size={14} /><div className={styles.labelNew}>Optimized</div></div>
              <button className={styles.closeBtn} onClick={() => setShowUnitReview(false)}><X size={24} /></button>
            </div>
            <div className={styles.diffContainer}>
              {unitReviewLoading ? (
                <div className={styles.statusBoxCentered}>
                  <div className={styles.thinkingSpinner} />
                  <div className={styles.stepsList}>
                    {activeSteps.map((step, i) => (
                      <div key={i} className={styles.stepItem}><CheckCircle2 size={14} color="var(--success)" /> {step}</div>
                    ))}
                    <div className={styles.stepItem}><Loader2 className={styles.spin} size={14} /> Performing surgical analysis...</div>
                  </div>
                </div>
              ) : (
                <div className={styles.unitLayout}>
                  <div className={styles.diffScroll}><ReactDiffViewer oldValue={unitData?.originalSnippet || ""} newValue={unitData?.fixedSnippet || ""} splitView={true} compareMethod={DiffMethod.CHARS} styles={diffStyles} /></div>
                  <div className={styles.unitFooter}>
                    <div className={styles.unitImpact}><Zap size={18} color="var(--primary)" /><div><strong>Trace Strategy</strong><p>{unitData?.impact || "Ready for deployment to theme ID 185064653119."}</p></div></div>
                    <div className={styles.unitActions}>
                      <div className={styles.autoDeployToggle} onClick={() => setAutoDeploy(!autoDeploy)}>
                        <div className={autoDeploy ? styles.toggleOn : styles.toggleOff}>
                          {autoDeploy ? <Zap size={14} /> : <ZapOff size={14} />}
                        </div>
                        <span>Auto-Deploy Fix</span>
                      </div>
                      <button className={styles.applyUnitBtn} onClick={handleApplyUnitFix}>
                        {autoDeploy ? "Apply & Sync Live" : "Apply to Local Disk"} <Sparkle size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Standard Diff Modal */}
      {showDiff && (
        <div className={styles.modalOverlay}>
          <div className={styles.modalContent + " " + styles.diffCheckerModal}>
            <div className={styles.modalHeader}><div className={styles.aiHeaderTitle}><FileSearch size={24} color="var(--success)" /><h3>Diff Review: {diffData?.fileName}</h3></div><button className={styles.closeBtn} onClick={() => setShowDiff(false)}><X size={24} /></button></div>
            <div className={styles.diffContainer}>{diffLoading ? <div className={styles.diffLoadingState}><div className={styles.thinkingSpinner} /><p>Loading diff...</p></div> : <div className={styles.diffScroll}><ReactDiffViewer oldValue={diffData?.old || ""} newValue={diffData?.new || ""} splitView={true} compareMethod={DiffMethod.CHARS} styles={diffStyles} /></div>}</div>
          </div>
        </div>
      )}

      {showFullReport && result && (
        <div className={styles.modalOverlay}><div className={styles.modalContent}><div className={styles.modalHeader}><h3>Detailed Lighthouse</h3><button className={styles.closeBtn} onClick={() => setShowFullReport(false)}><X size={24} /></button></div><iframe className={styles.reportIframe} srcDoc={result.html} /></div></div>
      )}
    </main>
  );
}

const diffStyles = { variables: { dark: { diffViewerBackground: '#0d0d12' } }, line: { padding: '4px 0' }, gutter: { padding: '0 15px', minWidth: '60px' } };

function ScoreCircle({ title, score, icon }: { title: string, score: number, icon: React.ReactNode }) {
  const color = score > 89 ? "var(--success)" : score > 49 ? "var(--average)" : "var(--fail)";
  const circumference = 2 * Math.PI * 45; const offset = circumference - (score / 100) * circumference;
  return (<div className={styles.scoreBox}><div className={styles.gaugeContainer}><svg viewBox="0 0 100 100" className={styles.gauge}><circle cx="50" cy="50" r="45" className={styles.gaugeBg} /><circle cx="50" cy="50" r="45" className={styles.gaugeFill} style={{ stroke: color, strokeDasharray: circumference, strokeDashoffset: offset }} /></svg><div className={styles.scoreText} style={{ color }}>{score}</div></div><div className={styles.scoreTitle}>{icon} {title}</div></div>);
}

function MetricCard({ title, value, type }: { title: string, value: string, type?: string }) {
  let status = "good"; if (value && value !== "--") { const val = parseFloat(value.replace(/[^0-9.]/g, '')); if (type === "lcp" && val > 2.5) status = val > 4 ? "poor" : "needs-improvement"; else if (type === "tbt" && val > 300) status = val > 600 ? "poor" : "needs-improvement"; else if (type === "cls" && val > 0.1) status = val > 0.25 ? "poor" : "needs-improvement"; }
  const icon = status === "good" ? <CheckCircle2 color="var(--success)" size={16} /> : status === "poor" ? <AlertTriangle color="var(--fail)" size={16} /> : <AlertCircle color="var(--average)" size={16} />;
  return (<div className={styles.metricCard}><div className={styles.metricHeader}><span className={styles.metricTitle}>{title}</span>{icon}</div><div className={styles.metricValue}>{value}</div></div>);
}

function SuggestionItem({ title, savings, impact, desc, canFix, onFix }: { title: string, savings: string, impact: string, desc: string, canFix: boolean, onFix: () => void }) {
  const [expanded, setExpanded] = useState(false); const [fixing, setFixing] = useState(false);
  const handleFixClick = async (e: React.MouseEvent) => { e.stopPropagation(); setFixing(true); try { await onFix(); } catch (e) { } finally { setFixing(false); } };
  return (
    <div className={styles.suggestionItem} onClick={() => setExpanded(!expanded)}>
      <div className={styles.suggestionHeaderInner}><div className={styles.suggestionMain}><div className={styles.suggestionInfo}><div className={styles.titleRow}>{expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}<h4>{title}</h4></div><span className={impact === "High" ? styles.highImpact : impact === "Diagnostic" ? styles.diagImpact : styles.medImpact}>{impact}</span></div><div className={styles.fixActionArea}><div className={styles.suggestionSavings}>{savings}</div>{canFix && (<button className={styles.miniFixBtn} disabled={fixing} onClick={handleFixClick}>{fixing ? <Loader2 className={styles.spin} size={14} /> : <>Unit Analysis <ArrowRight size={14} /></>}</button>)}</div></div></div>
      {expanded && (<div className={styles.suggestionDesc} onClick={(e) => e.stopPropagation()}><p dangerouslySetInnerHTML={{ __html: desc.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank">$1</a>') }} /></div>)}
    </div>
  );
}
