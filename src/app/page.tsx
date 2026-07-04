"use client";

import React, { useState, useCallback } from "react";
import mammoth from "mammoth";
import { generateEpub } from "../utils/epubBuilder";

interface Chapter {
  id: number;
  title: string;
  content: string;
  wordCount: number;
}

export default function Home() {
  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminId, setAdminId] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [loginError, setLoginError] = useState("");

  // Book metadata
  const [bookTitle, setBookTitle] = useState("Untitled");
  const [author, setAuthor] = useState("Becko Hyun");
  const [publisher, setPublisher] = useState("Evvia Publishing");
  const [contact, setContact] = useState("evviacorp@gmail.com");

  // Workflow
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [splitPattern, setSplitPattern] = useState(
    "(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])"
  );
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isBuilding, setIsBuilding] = useState(false);
  const [selectedChapter, setSelectedChapter] = useState<Chapter | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminId === "admin" && adminPw === "123jesus") {
      sessionStorage.setItem("authenticated", "true");
      setIsAuthenticated(true);
    } else {
      setLoginError("Invalid ID or Password.");
    }
  };

  const splitManuscript = useCallback((text: string, pattern: string) => {
    try {
      const regex = new RegExp(pattern, "m");
      const rawChunks = text.split(regex);
      const result: Chapter[] = [];
      let counter = 1;
      rawChunks.forEach((chunk) => {
        const trimmed = chunk.trim();
        if (!trimmed) return;
        const lines = trimmed.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        const title =
          lines.length > 0 && lines[0].length < 120 ? lines[0] : `Chapter ${counter}`;
        result.push({
          id: counter,
          title,
          content: trimmed,
          wordCount: trimmed.split(/\s+/).length,
        });
        counter++;
      });
      setChapters(result);
    } catch {
      // invalid regex — keep previous chapters
    }
  }, []);

  const processFile = async (f: File) => {
    setFile(f);
    setStatus("Parsing document...");
    try {
      const arrayBuffer = await f.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      setRawText(text);

      // Auto-detect title from first non-empty line
      const firstLine = text.split("\n").map((l) => l.trim()).find((l) => l.length > 0);
      if (firstLine) setBookTitle(firstLine.substring(0, 100));

      splitManuscript(text, splitPattern);
      setStatus("");
    } catch {
      setStatus("Failed to parse document. Please check the file.");
    }
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) await processFile(f);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.endsWith(".docx")) await processFile(f);
  };

  const handlePatternChange = (newPattern: string) => {
    setSplitPattern(newPattern);
    if (rawText) splitManuscript(rawText, newPattern);
  };

  const handleDownload = async () => {
    if (chapters.length === 0) return;
    setIsBuilding(true);
    setStatus("Building EPUB...");
    try {
      const blob = await generateEpub(
        { title: bookTitle, author, publisher, contact },
        chapters.map((ch) => ({ title: ch.title, content: ch.content }))
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "ebook"}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("Download complete!");
      setTimeout(() => setStatus(""), 3000);
    } catch {
      setStatus("Failed to build EPUB. Please try again.");
    } finally {
      setIsBuilding(false);
    }
  };

  const totalWords = chapters.reduce((s, c) => s + c.wordCount, 0);

  // ── LOGIN ─────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="login-card glass">
          <div className="login-brand">
            <span className="badge">Evvia Publishing</span>
            <h1>EPUB Converter</h1>
            <p>Admin access required</p>
          </div>
          <form onSubmit={handleLogin} className="login-form">
            <div className="field">
              <label>ID</label>
              <input className="input-field" type="text" value={adminId}
                onChange={(e) => setAdminId(e.target.value)} placeholder="admin" required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input-field" type="password" value={adminPw}
                onChange={(e) => setAdminPw(e.target.value)} placeholder="••••••••" required />
            </div>
            {loginError && <p className="err">{loginError}</p>}
            <button type="submit" className="btn-primary">Unlock →</button>
          </form>
        </div>

        <style jsx>{`
          .login-wrapper {
            min-height: 100vh; display: flex; align-items: center;
            justify-content: center; padding: 24px;
          }
          .login-card { max-width: 380px; width: 100%; padding: 40px; }
          .login-brand { text-align: center; margin-bottom: 32px; }
          .badge {
            display: inline-block; background: linear-gradient(135deg, var(--primary), var(--secondary));
            color: #050508; font-size: 10px; font-weight: 800; letter-spacing: 1px;
            text-transform: uppercase; padding: 4px 12px; border-radius: 999px; margin-bottom: 14px;
          }
          h1 { font-size: 26px; font-weight: 700; margin-bottom: 8px; }
          p { color: var(--foreground-muted); font-size: 14px; }
          .login-form { display: flex; flex-direction: column; gap: 18px; }
          .field { display: flex; flex-direction: column; gap: 6px; }
          label { font-size: 11px; font-weight: 600; color: var(--foreground-muted); text-transform: uppercase; letter-spacing: .5px; }
          .err { color: var(--danger); font-size: 13px; text-align: center; }
          .btn-primary { margin-top: 4px; }
        `}</style>
      </div>
    );
  }

  // ── MAIN APP ───────────────────────────────────────────────────────────────
  return (
    <div className="app">
      {/* Header */}
      <header className="glass topbar">
        <div className="inner topbar-inner">
          <div className="topbar-brand">
            <span className="badge sm">Evvia Pub</span>
            <span className="topbar-title">EPUB Converter</span>
          </div>
          <button className="btn-ghost" onClick={() => {
            sessionStorage.removeItem("authenticated");
            setIsAuthenticated(false);
          }}>Logout</button>
        </div>
      </header>

      <main className="inner main-grid">

        {/* ── LEFT PANEL ── */}
        <aside className="left-panel">

          {/* Metadata */}
          <section className="glass card">
            <h2 className="card-title">📖 Book Info</h2>
            <div className="meta-grid">
              {[
                ["Title", bookTitle, setBookTitle],
                ["Author", author, setAuthor],
                ["Publisher", publisher, setPublisher],
                ["Contact", contact, setContact],
              ].map(([label, value, setter]) => (
                <div className="field" key={label as string}>
                  <label>{label as string}</label>
                  <input className="input-field" type="text"
                    value={value as string}
                    onChange={(e) => (setter as (v: string) => void)(e.target.value)} />
                </div>
              ))}
            </div>
          </section>

          {/* Upload */}
          <section className="glass card">
            <h2 className="card-title">📂 Upload .docx</h2>
            <div
              className={`dropzone ${isDragging ? "drag-over" : ""} ${file ? "has-file" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input id="file-input" type="file" accept=".docx"
                onChange={handleFileInput} className="hidden" />
              <label htmlFor="file-input" className="dropzone-inner">
                <span className="drop-icon">{file ? "✅" : "📄"}</span>
                {file
                  ? <><strong className="file-name">{file.name}</strong><span className="file-sub">{totalWords.toLocaleString()} words · {chapters.length} chapters</span></>
                  : <><span>Drop your <strong>.docx</strong> here</span><span className="file-sub">or click to browse</span></>
                }
              </label>
            </div>
          </section>

          {/* Split Config */}
          {rawText && (
            <section className="glass card">
              <h2 className="card-title">✂️ Chapter Split</h2>
              <div className="field">
                <label>Regex Pattern</label>
                <input className="input-field mono" type="text"
                  value={splitPattern}
                  onChange={(e) => handlePatternChange(e.target.value)} />
                <small className="hint">Uses lookahead so chapter titles stay at the top of each chunk.</small>
              </div>
              <div className="presets">
                {[
                  ["Eng/Kor Standard", "(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])"],
                  ["Markdown H1", "(?=^#[^#])"],
                  ["ACT split", "(?=^ACT\\s+\\d+)"],
                  ["PART split", "(?=^PART\\s+\\d+)"],
                ].map(([label, pat]) => (
                  <button key={label as string} className="preset-pill"
                    onClick={() => handlePatternChange(pat as string)}>
                    {label as string}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Download */}
          {chapters.length > 0 && (
            <section className="glass card cta-card">
              <div className="cta-info">
                <span className="cta-stat">{chapters.length} chapters</span>
                <span className="cta-dot">·</span>
                <span className="cta-stat">{totalWords.toLocaleString()} words</span>
              </div>
              {status && <p className={`status-msg ${isBuilding ? "building" : ""}`}>{status}</p>}
              <button className="btn-primary cta-btn" onClick={handleDownload} disabled={isBuilding}>
                {isBuilding ? "Building…" : "📥 Download EPUB"}
              </button>
            </section>
          )}
        </aside>

        {/* ── RIGHT PANEL ── */}
        <div className="right-panel">
          {chapters.length === 0 ? (
            <div className="glass card empty-state">
              <span className="empty-icon">📚</span>
              <h3>No manuscript loaded</h3>
              <p>Upload a .docx file on the left to see a chapter preview here.</p>
            </div>
          ) : (
            <>
              <div className="glass card chapters-card">
                <h2 className="card-title">📑 Chapters ({chapters.length})</h2>
                <div className="chapters-list">
                  {chapters.map((ch) => (
                    <button
                      key={ch.id}
                      className={`chapter-row ${selectedChapter?.id === ch.id ? "active" : ""}`}
                      onClick={() => setSelectedChapter(ch.id === selectedChapter?.id ? null : ch)}
                    >
                      <span className="ch-num">#{ch.id}</span>
                      <span className="ch-title">{ch.title}</span>
                      <span className="ch-words">{ch.wordCount.toLocaleString()} w</span>
                    </button>
                  ))}
                </div>
              </div>

              {selectedChapter && (
                <div className="glass card preview-card">
                  <div className="preview-head">
                    <h2 className="card-title" style={{ marginBottom: 0 }}>{selectedChapter.title}</h2>
                    <button className="btn-ghost sm" onClick={() => setSelectedChapter(null)}>✕</button>
                  </div>
                  <div className="preview-text">{selectedChapter.content}</div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <style jsx>{`
        .app { min-height: 100vh; display: flex; flex-direction: column; padding-bottom: 60px; }

        /* Topbar */
        .topbar { border-radius: 0; border-top: none; border-left: none; border-right: none; position: sticky; top: 0; z-index: 50; }
        .topbar-inner { height: 64px; display: flex; align-items: center; justify-content: space-between; }
        .topbar-brand { display: flex; align-items: center; gap: 10px; }
        .topbar-title { font-size: 17px; font-weight: 700; letter-spacing: -0.3px; }
        .badge { display: inline-block; background: linear-gradient(135deg, var(--primary), var(--secondary)); color: #050508; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 3px 8px; border-radius: 999px; }
        .badge.sm { font-size: 9px; padding: 2px 7px; }

        /* Layout */
        .inner { max-width: 1200px; width: 100%; margin: 0 auto; padding: 0 24px; }
        .main-grid { display: grid; grid-template-columns: 400px 1fr; gap: 28px; margin-top: 32px; }
        @media (max-width: 900px) { .main-grid { grid-template-columns: 1fr; } }
        .left-panel, .right-panel { display: flex; flex-direction: column; gap: 20px; }

        /* Cards */
        .card { padding: 22px; }
        .card-title {
          font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px;
          color: var(--foreground-muted); margin-bottom: 16px;
          border-bottom: 1px solid rgba(255,255,255,.05); padding-bottom: 8px;
        }

        /* Metadata form */
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .field { display: flex; flex-direction: column; gap: 5px; }
        label { font-size: 11px; font-weight: 600; color: var(--foreground-muted); text-transform: uppercase; letter-spacing: .5px; }
        .hint { font-size: 11px; color: var(--foreground-muted); margin-top: 4px; }

        /* Dropzone */
        .dropzone {
          border: 2px dashed rgba(255,255,255,.1); border-radius: 12px;
          transition: all .2s; cursor: pointer;
        }
        .dropzone:hover, .dropzone.drag-over { border-color: var(--primary); background: rgba(0,242,254,.03); }
        .dropzone.has-file { border-color: rgba(0,242,254,.3); border-style: solid; }
        .hidden { display: none; }
        .dropzone-inner {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          padding: 32px 20px; text-align: center; gap: 6px; cursor: pointer;
          font-size: 14px; color: var(--foreground-muted);
        }
        .drop-icon { font-size: 28px; margin-bottom: 4px; }
        .file-name { color: var(--primary); font-size: 13px; }
        .file-sub { font-size: 12px; color: var(--foreground-muted); }

        /* Presets */
        .presets { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 10px; }
        .preset-pill {
          background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08);
          color: var(--foreground-muted); font-size: 11px; padding: 4px 10px;
          border-radius: 999px; cursor: pointer; transition: all .15s;
        }
        .preset-pill:hover { background: rgba(0,242,254,.08); border-color: var(--primary); color: var(--foreground); }
        .mono { font-family: monospace; font-size: 12px; }

        /* CTA card */
        .cta-card { display: flex; flex-direction: column; gap: 12px; }
        .cta-info { display: flex; align-items: center; gap: 8px; font-size: 14px; color: var(--foreground-muted); }
        .cta-stat { font-weight: 600; color: var(--foreground); }
        .cta-dot { color: var(--foreground-muted); }
        .cta-btn { width: 100%; font-size: 15px; padding: 14px; }
        .status-msg { font-size: 12px; color: var(--foreground-muted); text-align: center; }
        .status-msg.building { color: var(--primary); }

        /* Chapters list */
        .chapters-card { flex-grow: 1; }
        .chapters-list { display: flex; flex-direction: column; gap: 4px; max-height: 460px; overflow-y: auto; padding-right: 4px; }
        .chapter-row {
          display: grid; grid-template-columns: 36px 1fr auto; align-items: center;
          gap: 10px; padding: 10px 12px; border-radius: 8px; cursor: pointer;
          background: rgba(255,255,255,.02); border: 1px solid transparent;
          text-align: left; transition: all .15s; width: 100%;
        }
        .chapter-row:hover { background: rgba(255,255,255,.05); border-color: rgba(255,255,255,.08); }
        .chapter-row.active { background: rgba(0,242,254,.05); border-color: rgba(0,242,254,.25); }
        .ch-num { font-size: 11px; font-weight: 700; color: var(--primary); }
        .ch-title { font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ch-words { font-size: 11px; color: var(--foreground-muted); white-space: nowrap; }

        /* Preview */
        .preview-card { margin-top: 0; }
        .preview-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
        .preview-text {
          font-family: Georgia, serif; font-size: 14px; line-height: 1.75;
          white-space: pre-wrap; max-height: 520px; overflow-y: auto;
          background: rgba(0,0,0,.25); border: 1px solid rgba(255,255,255,.04);
          border-radius: 8px; padding: 20px; color: #d4d8e3;
        }

        /* Empty state */
        .empty-state {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          text-align: center; padding: 80px 40px; gap: 12px;
        }
        .empty-icon { font-size: 48px; }
        .empty-state h3 { font-size: 18px; font-weight: 600; }
        .empty-state p { color: var(--foreground-muted); font-size: 14px; max-width: 280px; }

        /* Utility buttons */
        .btn-ghost {
          background: transparent; border: 1px solid rgba(255,255,255,.08);
          color: var(--foreground-muted); font-size: 13px; padding: 7px 14px;
          border-radius: 7px; cursor: pointer; transition: all .15s;
        }
        .btn-ghost:hover { background: rgba(255,255,255,.06); color: var(--foreground); }
        .btn-ghost.sm { font-size: 12px; padding: 4px 10px; }
      `}</style>
    </div>
  );
}
