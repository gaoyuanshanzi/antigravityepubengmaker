"use client";

import React, { useState } from "react";
import mammoth from "mammoth";
import { generateEpub } from "../utils/epubBuilder";

export default function Home() {
  // Auth
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminId, setAdminId] = useState("");
  const [adminPw, setAdminPw] = useState("");
  const [loginError, setLoginError] = useState("");

  // Book metadata
  const [bookTitle, setBookTitle] = useState("");
  const [author, setAuthor] = useState("Becko Hyun");
  const [publisher, setPublisher] = useState("Evvia Publishing");
  const [contact, setContact] = useState("evviacorp@gmail.com");

  // File & status
  const [file, setFile] = useState<File | null>(null);
  const [wordCount, setWordCount] = useState(0);
  const [docText, setDocText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<"idle" | "parsing" | "building" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminId === "admin" && adminPw === "123jesus") {
      sessionStorage.setItem("authenticated", "true");
      setIsAuthenticated(true);
    } else {
      setLoginError("Invalid ID or Password.");
    }
  };

  const parseDocx = async (f: File) => {
    setFile(f);
    setStatus("parsing");
    setErrorMsg("");
    try {
      const arrayBuffer = await f.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      setDocText(text);
      setWordCount(text.split(/\s+/).filter(Boolean).length);

      // Use first non-empty line as default title
      const firstLine = text.split("\n").map(l => l.trim()).find(l => l.length > 0) ?? "";
      if (firstLine) setBookTitle(firstLine.substring(0, 100));

      setStatus("idle");
    } catch {
      setStatus("error");
      setErrorMsg("Could not read the file. Please make sure it is a valid .docx document.");
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseDocx(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.name.endsWith(".docx")) parseDocx(f);
  };

  const handleDownload = async () => {
    if (!docText || !bookTitle.trim()) return;
    setStatus("building");
    setErrorMsg("");
    try {
      const blob = await generateEpub(
        { title: bookTitle.trim(), author, publisher, contact },
        [{ title: bookTitle.trim(), content: docText }]
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookTitle.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_")}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStatus("done");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
      setErrorMsg("Failed to build EPUB. Please try again.");
    }
  };

  const canDownload = !!docText && !!bookTitle.trim() && status !== "parsing" && status !== "building";

  // ── LOGIN ────────────────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="center-wrap">
        <div className="glass login-box">
          <p className="badge">Evvia Publishing</p>
          <h1>EPUB Converter</h1>
          <p className="sub">Admin access required</p>
          <form onSubmit={handleLogin}>
            <div className="field">
              <label>ID</label>
              <input className="input-field" type="text" value={adminId}
                onChange={e => setAdminId(e.target.value)} placeholder="admin" required />
            </div>
            <div className="field">
              <label>Password</label>
              <input className="input-field" type="password" value={adminPw}
                onChange={e => setAdminPw(e.target.value)} placeholder="••••••••" required />
            </div>
            {loginError && <p className="err">{loginError}</p>}
            <button type="submit" className="btn-primary mt">Sign in →</button>
          </form>
        </div>
        <style jsx>{`
          .center-wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
          .login-box { width: 100%; max-width: 360px; padding: 40px; text-align: center; }
          .badge { display: inline-block; background: linear-gradient(135deg, var(--primary), var(--secondary)); color: #050508; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 4px 12px; border-radius: 999px; margin-bottom: 14px; }
          h1 { font-size: 26px; font-weight: 700; margin-bottom: 6px; }
          .sub { color: var(--foreground-muted); font-size: 14px; margin-bottom: 28px; }
          form { display: flex; flex-direction: column; gap: 16px; text-align: left; }
          .field { display: flex; flex-direction: column; gap: 6px; }
          label { font-size: 11px; font-weight: 600; color: var(--foreground-muted); text-transform: uppercase; letter-spacing: .5px; }
          .err { color: var(--danger); font-size: 13px; text-align: center; }
          .mt { margin-top: 4px; }
        `}</style>
      </div>
    );
  }

  // ── MAIN ─────────────────────────────────────────────────────────────────
  return (
    <div className="app">

      {/* Topbar */}
      <header className="glass topbar">
        <div className="wrap topbar-row">
          <div className="brand">
            <span className="badge sm">Evvia Publishing</span>
            <span className="brand-name">EPUB Converter</span>
          </div>
          <button className="btn-ghost" onClick={() => { sessionStorage.removeItem("authenticated"); setIsAuthenticated(false); }}>
            Logout
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="wrap content">
        <div className="glass main-card">

          {/* ── Step 1: Upload ── */}
          <section className="section">
            <h2 className="section-title">① Upload Document</h2>
            <div
              className={`dropzone ${isDragging ? "over" : ""} ${file ? "has-file" : ""}`}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input id="file-in" type="file" accept=".docx" className="hidden" onChange={handleFileInput} />
              <label htmlFor="file-in" className="dropzone-label">
                {status === "parsing" ? (
                  <><span className="drop-icon spin">⏳</span><span>Parsing document…</span></>
                ) : file ? (
                  <>
                    <span className="drop-icon">✅</span>
                    <strong className="file-name">{file.name}</strong>
                    <span className="file-meta">{wordCount.toLocaleString()} words</span>
                    <span className="file-change">Click to replace</span>
                  </>
                ) : (
                  <>
                    <span className="drop-icon">📄</span>
                    <span>Drop your <strong>.docx</strong> file here</span>
                    <span className="file-meta">or click to browse</span>
                  </>
                )}
              </label>
            </div>
            {status === "error" && <p className="error-msg">{errorMsg}</p>}
          </section>

          {/* ── Step 2: Metadata ── */}
          {docText && (
            <section className="section">
              <h2 className="section-title">② Book Details</h2>
              <div className="meta-grid">
                <div className="field full">
                  <label>Title *</label>
                  <input className="input-field" type="text" value={bookTitle}
                    onChange={e => setBookTitle(e.target.value)} placeholder="Enter the book title" />
                </div>
                <div className="field">
                  <label>Author</label>
                  <input className="input-field" type="text" value={author}
                    onChange={e => setAuthor(e.target.value)} />
                </div>
                <div className="field">
                  <label>Publisher</label>
                  <input className="input-field" type="text" value={publisher}
                    onChange={e => setPublisher(e.target.value)} />
                </div>
                <div className="field full">
                  <label>Publisher Contact</label>
                  <input className="input-field" type="text" value={contact}
                    onChange={e => setContact(e.target.value)} />
                </div>
              </div>
            </section>
          )}

          {/* ── Step 3: Download ── */}
          {docText && (
            <section className="section">
              <h2 className="section-title">③ Convert &amp; Download</h2>
              <button
                className={`btn-primary dl-btn ${!canDownload ? "disabled" : ""}`}
                onClick={handleDownload}
                disabled={!canDownload}
              >
                {status === "building" ? "⏳ Building EPUB…" :
                 status === "done"     ? "✅ Downloaded!" :
                 "📥 Download EPUB"}
              </button>
              {!bookTitle.trim() && <p className="warn">Please enter a book title above.</p>}
            </section>
          )}

        </div>
      </div>

      <style jsx>{`
        .app { min-height: 100vh; display: flex; flex-direction: column; }

        /* Topbar */
        .topbar { border-radius: 0; border-top: none; border-left: none; border-right: none; position: sticky; top: 0; z-index: 50; }
        .topbar-row { height: 60px; display: flex; align-items: center; justify-content: space-between; }
        .brand { display: flex; align-items: center; gap: 10px; }
        .badge { display: inline-block; background: linear-gradient(135deg, var(--primary), var(--secondary)); color: #050508; font-size: 10px; font-weight: 800; letter-spacing: 1px; text-transform: uppercase; padding: 3px 10px; border-radius: 999px; }
        .badge.sm { font-size: 9px; }
        .brand-name { font-size: 16px; font-weight: 700; letter-spacing: -.2px; }

        /* Layout */
        .wrap { max-width: 680px; width: 100%; margin: 0 auto; padding: 0 24px; }
        .content { padding-top: 48px; padding-bottom: 80px; }
        .main-card { padding: 40px; display: flex; flex-direction: column; gap: 0; }

        /* Sections */
        .section { padding: 28px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
        .section:last-child { border-bottom: none; padding-bottom: 0; }
        .section-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--foreground-muted); margin-bottom: 18px; }

        /* Dropzone */
        .hidden { display: none; }
        .dropzone { border: 2px dashed rgba(255,255,255,.1); border-radius: 14px; transition: all .2s; cursor: pointer; }
        .dropzone.over, .dropzone:hover { border-color: var(--primary); background: rgba(0,242,254,.03); }
        .dropzone.has-file { border-style: solid; border-color: rgba(0,242,254,.3); }
        .dropzone-label { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; padding: 44px 24px; cursor: pointer; text-align: center; font-size: 15px; color: var(--foreground-muted); }
        .drop-icon { font-size: 36px; margin-bottom: 4px; }
        .drop-icon.spin { animation: spin 1.2s linear infinite; display: inline-block; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .file-name { font-size: 15px; font-weight: 600; color: var(--primary); }
        .file-meta { font-size: 13px; color: var(--foreground-muted); }
        .file-change { font-size: 11px; color: rgba(255,255,255,.25); margin-top: 4px; }
        .error-msg { color: var(--danger); font-size: 13px; margin-top: 10px; text-align: center; }

        /* Metadata */
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .field { display: flex; flex-direction: column; gap: 6px; }
        .field.full { grid-column: 1 / -1; }
        label { font-size: 11px; font-weight: 600; color: var(--foreground-muted); text-transform: uppercase; letter-spacing: .5px; }

        /* Download button */
        .dl-btn { width: 100%; font-size: 16px; padding: 16px; letter-spacing: .2px; }
        .dl-btn.disabled { opacity: .45; cursor: not-allowed; transform: none !important; box-shadow: none !important; }
        .warn { font-size: 12px; color: #facc15; text-align: center; margin-top: 10px; }

        /* Ghost button */
        .btn-ghost { background: transparent; border: 1px solid rgba(255,255,255,.08); color: var(--foreground-muted); font-size: 13px; padding: 7px 14px; border-radius: 7px; cursor: pointer; transition: all .15s; }
        .btn-ghost:hover { background: rgba(255,255,255,.06); color: var(--foreground); }
      `}</style>
    </div>
  );
}
