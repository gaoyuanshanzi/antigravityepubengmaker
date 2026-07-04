"use client";

import React, { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";
import { generateEpub } from "../utils/epubBuilder";

// Types
interface Chapter {
  id: number;
  title: string;
  originalText: string;
  refinedText?: string;
  summary?: string;
  status: "pending" | "processing" | "completed" | "failed";
}

interface LogMessage {
  time: string;
  text: string;
  type: "info" | "success" | "warning" | "error";
}

export default function Home() {
  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [adminId, setAdminId] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [loginError, setLoginError] = useState("");

  // Settings state
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("gemini-2.0-flash");
  const [chapterDelay, setChapterDelay] = useState(8);
  const [customPrompt, setCustomPrompt] = useState(
    "Ensure grammar, style, and tone are polished. Adjust sentence flow to feel professional yet captivating. Retain specific formatting like line breaks or indentations if relevant."
  );

  // Book Metadata
  const [bookTitle, setBookTitle] = useState("Untitled Novel");
  const [author, setAuthor] = useState("Becko Hyun");
  const [publisher, setPublisher] = useState("Evvia Publishing");
  const [contact, setContact] = useState("evviacorp@gmail.com");

  // Workflow state
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [splitPattern, setSplitPattern] = useState(
    "(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])"
  );
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPreviewChapter, setSelectedPreviewChapter] = useState<Chapter | null>(null);

  // Timer
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Load saved settings on mount
  useEffect(() => {
    const auth = sessionStorage.getItem("authenticated");
    if (auth === "true") setIsAuthenticated(true);
    const storedKey = localStorage.getItem("gemini_api_key");
    if (storedKey) setApiKey(storedKey);
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Elapsed timer while processing
  useEffect(() => {
    if (isProcessing) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => setElapsedTime(prev => prev + 1), 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [isProcessing]);

  const addLog = (text: string, type: "info" | "success" | "warning" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, text, type }]);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminId === "admin" && adminPw === "123jesus") {
      sessionStorage.setItem("authenticated", "true");
      setIsAuthenticated(true);
    } else {
      setLoginError("Invalid Administrator ID or Password.");
    }
  };

  const handleSaveSettings = () => {
    localStorage.setItem("gemini_api_key", apiKey);
    setShowSettings(false);
    addLog("Settings saved successfully.", "success");
  };

  // Parse .docx file
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const uploadedFile = files[0];
    setFile(uploadedFile);
    addLog(`Reading file: ${uploadedFile.name}...`, "info");
    try {
      const arrayBuffer = await uploadedFile.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      setRawText(text);
      const firstLine = text.split("\n").map(l => l.trim()).find(l => l.length > 0) || "Untitled Novel";
      setBookTitle(firstLine.substring(0, 80));
      addLog(`File parsed. Total characters: ${text.length.toLocaleString()}`, "success");
      splitManuscript(text, splitPattern);
    } catch (err: any) {
      addLog(`Failed to parse docx: ${err.message}`, "error");
    }
  };

  // Split text into chapters
  const splitManuscript = (text: string, pattern: string) => {
    if (!text) return;
    addLog(`Splitting using pattern: "${pattern}"...`, "info");
    try {
      const regex = new RegExp(pattern, "m");
      const rawChunks = text.split(regex);
      const parsedChapters: Chapter[] = [];
      let counter = 1;
      rawChunks.forEach(chunk => {
        const trimmed = chunk.trim();
        if (!trimmed) return;
        const lines = trimmed.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const title = lines.length > 0 && lines[0].length < 100 ? lines[0] : `Chapter ${counter}`;
        parsedChapters.push({ id: counter, title, originalText: trimmed, status: "pending" });
        counter++;
      });
      setChapters(parsedChapters);
      addLog(`Detected ${parsedChapters.length} chapters.`, "success");
    } catch (err: any) {
      addLog(`Invalid regex pattern: ${err.message}`, "error");
    }
  };

  const handlePatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPattern = e.target.value;
    setSplitPattern(newPattern);
    if (rawText) splitManuscript(rawText, newPattern);
  };

  // Countdown sleep with log
  const countdownSleep = async (seconds: number, reason: string) => {
    for (let s = seconds; s > 0; s--) {
      addLog(`⏳ ${reason} — resuming in ${s}s...`, "warning");
      await new Promise(r => setTimeout(r, 1000));
    }
  };

  // Main processing pipeline
  const startProcessingPipeline = async () => {
    if (chapters.length === 0) {
      addLog("No chapters found. Please upload a file first.", "warning");
      return;
    }
    setIsProcessing(true);
    addLog("Starting sequential refinement pipeline...", "info");

    let previousSummary = "";
    const updatedChapters = [...chapters];

    for (let i = 0; i < updatedChapters.length; i++) {
      setCurrentChapterIndex(i);
      const ch = updatedChapters[i];
      addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Starting refinement...`, "info");
      updatedChapters[i] = { ...ch, status: "processing" };
      setChapters([...updatedChapters]);

      let chapterSuccess = false;
      let retryCount = 0;
      const maxClientRetries = 4;

      while (!chapterSuccess && retryCount <= maxClientRetries) {
        try {
          const res = await fetch("/api/refine", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chapterText: ch.originalText,
              previousSummary,
              customPrompt,
              apiKey,
              modelName,
            }),
          });

          if (res.status === 429) {
            const waitSec = 30 * Math.pow(2, retryCount);
            addLog(`[Chapter ${i + 1}] ⚠️ Quota exceeded (429). Auto-retry ${retryCount + 1}/${maxClientRetries}.`, "warning");
            await countdownSleep(waitSec, "Rate limit — waiting for Gemini quota reset");
            retryCount++;
            continue;
          }

          if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || `HTTP error ${res.status}`);
          }

          const data = await res.json();
          previousSummary = data.summary || previousSummary;
          updatedChapters[i].refinedText = data.refinedText;
          updatedChapters[i].summary = data.summary;
          updatedChapters[i].status = "completed";
          setChapters([...updatedChapters]);
          addLog(`[Chapter ${i + 1}/${updatedChapters.length}] ✓ Done. Summary: "${(data.summary || "").substring(0, 80)}..."`, "success");
          chapterSuccess = true;

        } catch (err: any) {
          updatedChapters[i].status = "failed";
          setChapters([...updatedChapters]);
          addLog(`[Chapter ${i + 1}] Failed: ${err.message}`, "error");
          addLog("Pipeline halted. Please check the error and retry.", "error");
          setIsProcessing(false);
          return;
        }
      }

      if (!chapterSuccess) {
        updatedChapters[i].status = "failed";
        setChapters([...updatedChapters]);
        addLog(`[Chapter ${i + 1}] Exhausted all retries. Pipeline halted.`, "error");
        setIsProcessing(false);
        return;
      }

      // Delay between chapters
      if (i < updatedChapters.length - 1 && chapterDelay > 0) {
        addLog(`⏸️ Waiting ${chapterDelay}s before next chapter...`, "info");
        await new Promise(r => setTimeout(r, chapterDelay * 1000));
      }
    }

    addLog("All chapters refined successfully!", "success");
    setIsProcessing(false);
  };

  // Compile and download EPUB
  const handleDownloadEpub = async () => {
    addLog("Compiling EPUB package...", "info");
    try {
      const epubChapters = chapters.map(ch => ({
        title: ch.title,
        content: ch.refinedText || ch.originalText,
      }));
      const blob = await generateEpub({ title: bookTitle, author, publisher, contact }, epubChapters);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog("EPUB downloaded successfully!", "success");
    } catch (err: any) {
      addLog(`Failed to compile EPUB: ${err.message}`, "error");
    }
  };

  const formatSeconds = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;

  const completedCount = chapters.filter(c => c.status === "completed").length;
  const progressPercent = chapters.length > 0 ? Math.round((completedCount / chapters.length) * 100) : 0;

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="glass login-card">
          <div className="logo-header">
            <span className="logo-badge">Evvia Publishing</span>
            <h1>EPUB Book Maker</h1>
            <p>Administrator access required to continue.</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <label>Administrator ID</label>
              <input type="text" className="input-field" value={adminId}
                onChange={e => setAdminId(e.target.value)} placeholder="Enter ID" required />
            </div>
            <div className="input-group">
              <label>Password</label>
              <input type="password" className="input-field" value={adminPw}
                onChange={e => setAdminPw(e.target.value)} placeholder="Enter password" required />
            </div>
            {loginError && <p className="error-text">{loginError}</p>}
            <button type="submit" className="btn-primary" style={{ width: "100%", marginTop: "12px" }}>
              Unlock System
            </button>
          </form>
        </div>

        <style jsx>{`
          .login-wrapper {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
          }
          .login-card { max-width: 420px; width: 100%; padding: 40px; }
          .logo-header { text-align: center; margin-bottom: 32px; }
          .logo-badge {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            color: #050508; font-size: 11px; font-weight: 800; padding: 4px 10px;
            border-radius: 9999px; text-transform: uppercase; letter-spacing: 1px;
            display: inline-block; margin-bottom: 12px;
          }
          h1 { font-size: 24px; letter-spacing: -0.5px; margin-bottom: 8px; font-weight: 700; }
          p { color: var(--foreground-muted); font-size: 14px; }
          .login-form { display: flex; flex-direction: column; gap: 20px; }
          .input-group { display: flex; flex-direction: column; gap: 8px; }
          label { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--foreground-muted); }
          .error-text { color: var(--danger); font-size: 13px; text-align: center; margin: 0; }
        `}</style>
      </div>
    );
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  return (
    <div className="dashboard-layout">
      {/* Header */}
      <header className="glass header-bar">
        <div className="container header-content">
          <div className="brand-logo">
            <span className="logo-badge">Evvia Pub</span>
            <h2>EPUB English Book Maker</h2>
          </div>
          <div className="header-actions">
            <button className="btn-secondary" onClick={() => setShowSettings(true)}>⚙️ Settings</button>
            <button className="btn-secondary" onClick={() => {
              sessionStorage.removeItem("authenticated");
              setIsAuthenticated(false);
            }}>Logout</button>
          </div>
        </div>
      </header>

      <main className="container main-content">
        {/* LEFT COLUMN */}
        <div className="control-col">

          {/* Book Metadata */}
          <section className="glass section-card">
            <h3>📖 Book Metadata</h3>
            <div className="form-grid-2">
              <div className="form-group">
                <label>Title</label>
                <input type="text" className="input-field" value={bookTitle}
                  onChange={e => setBookTitle(e.target.value)} placeholder="Book Title" />
              </div>
              <div className="form-group">
                <label>Author</label>
                <input type="text" className="input-field" value={author}
                  onChange={e => setAuthor(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Publisher</label>
                <input type="text" className="input-field" value={publisher}
                  onChange={e => setPublisher(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Contact</label>
                <input type="text" className="input-field" value={contact}
                  onChange={e => setContact(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Upload */}
          <section className="glass section-card">
            <h3>📂 Upload Manuscript</h3>
            <div className="upload-dropzone">
              <input type="file" id="file-upload" accept=".docx"
                onChange={handleFileUpload} className="hidden-file-input" />
              <label htmlFor="file-upload" className="dropzone-label">
                <div className="upload-icon">📄</div>
                {file
                  ? <span className="file-name">{file.name}</span>
                  : <span>Drop your <strong>.docx</strong> file here or click to browse</span>}
              </label>
            </div>

            {rawText && (
              <div className="split-config">
                <div className="form-group">
                  <label>Chapter Split Regex Pattern</label>
                  <input type="text" className="input-field font-mono"
                    value={splitPattern} onChange={handlePatternChange} />
                  <small className="help-text">Uses lookahead to keep chapter titles in each chunk.</small>
                </div>
                <div className="presets-list">
                  {[
                    ["English / Korean Standard", "(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])"],
                    ["Markdown H1 (#)", "(?=^#[^#])"],
                    ["ACT Split", "(?=^ACT\\s+\\d+)"],
                  ].map(([label, pat]) => (
                    <button key={label} className="badge-btn" onClick={() => {
                      setSplitPattern(pat);
                      splitManuscript(rawText, pat);
                    }}>{label}</button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* Engine Operations */}
          {chapters.length > 0 && (
            <section className="glass section-card">
              <h3>⚡ Engine Operations</h3>
              {!isProcessing && completedCount < chapters.length && (
                <button className="btn-primary full-width" onClick={startProcessingPipeline}>
                  🚀 Start Relay Refinement
                </button>
              )}
              {isProcessing && (
                <div className="progress-container">
                  <div className="progress-labels">
                    <span>Progress: {progressPercent}%</span>
                    <span>{formatSeconds(elapsedTime)}</span>
                  </div>
                  <div className="progress-bar-bg">
                    <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <p className="active-task-text">
                    Processing: {chapters[currentChapterIndex]?.title || "Preparing..."}
                  </p>
                </div>
              )}
              {completedCount > 0 && !isProcessing && (
                <div className="download-area">
                  <div className="alert-box success">
                    ✓ {completedCount}/{chapters.length} chapters refined.
                  </div>
                  <button className="btn-primary full-width" style={{ marginTop: "12px" }}
                    onClick={handleDownloadEpub}>
                    📥 Compile &amp; Download EPUB
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Logs */}
          <section className="glass section-card">
            <div className="console-header">
              <h3>💻 Operation Logs</h3>
              <button className="btn-clear-logs" onClick={() => setLogs([])}>Clear</button>
            </div>
            <div className="console-display">
              {logs.length === 0
                ? <p className="empty-logs">Ready. Upload a manuscript to begin.</p>
                : logs.map((log, i) => (
                  <div key={i} className={`log-line ${log.type}`}>
                    <span className="log-time">[{log.time}]</span>
                    <span className="log-text"> {log.text}</span>
                  </div>
                ))
              }
              <div ref={logEndRef} />
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN */}
        <div className="preview-col">
          {/* Chapters list */}
          <section className="glass section-card chapters-list-card">
            <h3>📑 Chapter List ({chapters.length})</h3>
            {chapters.length === 0
              ? <p className="empty-chapters">No chapters yet. Upload a manuscript.</p>
              : (
                <div className="chapters-grid">
                  {chapters.map(ch => (
                    <div
                      key={ch.id}
                      className={`chapter-item ${ch.status} ${selectedPreviewChapter?.id === ch.id ? "active" : ""}`}
                      onClick={() => setSelectedPreviewChapter(ch)}
                    >
                      <div className="chapter-meta">
                        <span className="chapter-num">#{ch.id}</span>
                        <span className="chapter-words">
                          {ch.originalText.split(/\s+/).length.toLocaleString()} w
                        </span>
                      </div>
                      <h4 className="chapter-title-text">{ch.title}</h4>
                      <div className="chapter-status-row">
                        <span className="status-badge">{ch.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </section>

          {/* Chapter Preview */}
          {selectedPreviewChapter && (
            <section className="glass section-card">
              <div className="preview-header">
                <h3>🔍 {selectedPreviewChapter.title}</h3>
                <button className="btn-close-preview" onClick={() => setSelectedPreviewChapter(null)}>✕ Close</button>
              </div>
              <div className="content-comparison">
                <div className="comparison-pane">
                  <h5>Original</h5>
                  <div className="text-pane">{selectedPreviewChapter.originalText}</div>
                </div>
                <div className="comparison-pane">
                  <h5>Refined</h5>
                  <div className="text-pane refined-pane">
                    {selectedPreviewChapter.refinedText
                      ? selectedPreviewChapter.refinedText
                      : <span className="placeholder-text">Pending refinement...</span>}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <div className="modal-backdrop">
          <div className="glass modal-card">
            <h3>⚙️ Engine Configuration</h3>
            <div className="modal-body">
              <div className="form-group">
                <label>Gemini API Key</label>
                <input type="password" className="input-field" value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={process.env.GEMINI_API_KEY ? "Using server env key" : "Paste your API key"} />
                <small className="help-text">Saved in browser localStorage. Never sent to third parties.</small>
              </div>
              <div className="form-group">
                <label>Model</label>
                <select className="input-field" value={modelName} onChange={e => setModelName(e.target.value)}>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Recommended)</option>
                  <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (Fastest)</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Most capable)</option>
                </select>
              </div>
              <div className="form-group">
                <label>Editorial Instructions</label>
                <textarea className="input-field" rows={4} value={customPrompt}
                  onChange={e => setCustomPrompt(e.target.value)} />
              </div>
              <div className="form-group">
                <label>Chapter Delay: {chapterDelay}s</label>
                <input type="range" min={0} max={60} step={2} value={chapterDelay}
                  onChange={e => setChapterDelay(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--primary)" }} />
                <small className="help-text">Wait between chapters to respect free-tier rate limits. Recommended: 8–15s.</small>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveSettings}>Save</button>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .dashboard-layout {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          padding-bottom: 60px;
        }
        .header-bar {
          border-radius: 0;
          border-top: none; border-left: none; border-right: none;
          position: sticky; top: 0; z-index: 50;
        }
        .header-content {
          height: 70px; display: flex; align-items: center; justify-content: space-between;
        }
        .brand-logo { display: flex; align-items: center; gap: 12px; }
        .logo-badge {
          background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
          color: #050508; font-size: 10px; font-weight: 800; padding: 3px 8px;
          border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px;
        }
        h2 { font-size: 18px; font-weight: 700; letter-spacing: -0.3px; }
        .header-actions { display: flex; gap: 12px; }
        .main-content {
          margin-top: 32px;
          display: grid;
          grid-template-columns: 460px 1fr;
          gap: 28px;
        }
        @media (max-width: 1024px) { .main-content { grid-template-columns: 1fr; } }
        .control-col, .preview-col { display: flex; flex-direction: column; gap: 24px; }
        .section-card { padding: 24px; }
        h3 {
          font-size: 13px; font-weight: 600; margin-bottom: 18px;
          letter-spacing: 0.3px; text-transform: uppercase;
          color: var(--foreground-muted);
          border-bottom: 1px solid rgba(255,255,255,0.05);
          padding-bottom: 8px;
        }
        .form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .form-group { display: flex; flex-direction: column; gap: 6px; }
        .form-group label {
          font-size: 11px; font-weight: 600; color: var(--foreground-muted);
          text-transform: uppercase; letter-spacing: 0.5px;
        }
        .help-text { font-size: 11px; color: var(--foreground-muted); margin-top: 4px; }
        .upload-dropzone {
          border: 2px dashed rgba(255,255,255,0.1); border-radius: 12px;
          background: rgba(255,255,255,0.01); transition: all var(--transition-fast); cursor: pointer;
        }
        .upload-dropzone:hover { border-color: var(--primary); background: rgba(0,242,254,0.02); }
        .hidden-file-input { display: none; }
        .dropzone-label {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; padding: 40px 24px; text-align: center;
          cursor: pointer; font-size: 14px; color: var(--foreground-muted);
        }
        .upload-icon { font-size: 32px; margin-bottom: 12px; }
        .file-name { color: var(--primary); font-weight: 600; }
        .split-config { margin-top: 20px; display: flex; flex-direction: column; gap: 12px; }
        .presets-list { display: flex; flex-wrap: wrap; gap: 8px; }
        .badge-btn {
          background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
          color: var(--foreground-muted); font-size: 11px; padding: 4px 10px;
          border-radius: 9999px; cursor: pointer; transition: all var(--transition-fast);
        }
        .badge-btn:hover { background: rgba(255,255,255,0.08); color: var(--foreground); border-color: var(--primary); }
        .full-width { width: 100%; }
        .progress-container { display: flex; flex-direction: column; gap: 12px; }
        .progress-labels { display: flex; justify-content: space-between; font-size: 13px; font-weight: 600; }
        .progress-bar-bg { height: 8px; background: rgba(255,255,255,0.05); border-radius: 9999px; overflow: hidden; }
        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%);
          border-radius: 9999px; transition: width 0.3s ease;
        }
        .active-task-text { font-size: 12px; color: var(--primary); font-weight: 500; }
        .alert-box.success {
          background: rgba(16,185,129,0.06); border: 1px solid rgba(16,185,129,0.15);
          color: var(--success); padding: 12px 16px; border-radius: 8px; font-size: 13px;
        }
        .console-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .console-header h3 { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        .btn-clear-logs {
          background: transparent; border: none; color: var(--foreground-muted);
          font-size: 11px; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px;
        }
        .btn-clear-logs:hover { color: var(--foreground); }
        .console-display {
          background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.04);
          border-radius: 8px; padding: 14px; font-family: monospace; font-size: 12px;
          height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 5px;
        }
        .empty-logs { color: rgba(255,255,255,0.2); text-align: center; margin-top: 100px; }
        .log-time { color: var(--foreground-muted); }
        .log-line.info  { color: #cbd5e1; }
        .log-line.success { color: #4ade80; }
        .log-line.warning { color: #facc15; }
        .log-line.error { color: #f87171; }
        .chapters-list-card { flex-grow: 1; }
        .empty-chapters { text-align: center; padding: 40px; color: var(--foreground-muted); font-size: 13px; }
        .chapters-grid {
          display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
          gap: 12px; max-height: 420px; overflow-y: auto; padding-right: 4px;
        }
        .chapter-item {
          background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05);
          border-radius: 8px; padding: 12px; cursor: pointer;
          transition: all var(--transition-fast);
          display: flex; flex-direction: column; gap: 6px;
        }
        .chapter-item:hover { background: rgba(255,255,255,0.04); border-color: var(--primary); }
        .chapter-item.active {
          background: rgba(0,242,254,0.04); border-color: var(--primary);
          box-shadow: 0 0 10px rgba(0,242,254,0.1);
        }
        .chapter-meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--foreground-muted); }
        .chapter-num { font-weight: bold; color: var(--primary); }
        .chapter-title-text {
          font-size: 12px; font-weight: 600; white-space: nowrap;
          overflow: hidden; text-overflow: ellipsis;
        }
        .chapter-status-row { font-size: 9px; margin-top: auto; }
        .status-badge { text-transform: uppercase; font-weight: 700; }
        .pending .status-badge { color: var(--foreground-muted); }
        .processing .status-badge { color: var(--secondary); }
        .completed .status-badge { color: var(--success); }
        .failed .status-badge { color: var(--danger); }
        .preview-header {
          display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;
        }
        .preview-header h3 { margin-bottom: 0; border-bottom: none; padding-bottom: 0; }
        .btn-close-preview {
          background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1);
          color: var(--foreground); font-size: 11px; padding: 4px 12px;
          border-radius: 6px; cursor: pointer;
        }
        .btn-close-preview:hover { background: rgba(255,255,255,0.1); }
        .content-comparison { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        @media (max-width: 768px) { .content-comparison { grid-template-columns: 1fr; } }
        .comparison-pane { display: flex; flex-direction: column; gap: 8px; }
        .comparison-pane h5 {
          font-size: 11px; color: var(--foreground-muted); text-transform: uppercase; letter-spacing: 0.5px;
        }
        .text-pane {
          background: rgba(0,0,0,0.25); border: 1px solid rgba(255,255,255,0.04);
          border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.6;
          max-height: 400px; overflow-y: auto; white-space: pre-wrap;
          font-family: Georgia, serif;
        }
        .refined-pane { border-color: rgba(0,242,254,0.1); }
        .placeholder-text { color: var(--foreground-muted); font-style: italic; }
        .modal-backdrop {
          position: fixed; inset: 0; background: rgba(0,0,0,0.7);
          backdrop-filter: blur(8px); display: flex; align-items: center;
          justify-content: center; z-index: 100; padding: 24px;
        }
        .modal-card { max-width: 500px; width: 100%; padding: 28px; }
        .modal-card h3 { margin-bottom: 20px; }
        .modal-body { display: flex; flex-direction: column; gap: 16px; margin-bottom: 24px; }
        .modal-footer { display: flex; justify-content: flex-end; gap: 12px; }
      `}</style>
    </div>
  );
}
