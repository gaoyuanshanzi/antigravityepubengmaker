"use client";

import React, { useState, useEffect, useRef } from "react";
import mammoth from "mammoth";
import { generateEpub } from "../utils/epubBuilder";

// Define Types
interface Chapter {
  id: number;
  title: string;
  originalText: string;
  refinedText?: string;
  summary?: string;
  illustrationPrompt?: string;
  illustrationUrl?: string;
  illustrationBlob?: Blob;
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

  // App settings state
  const [apiKey, setApiKey] = useState("");
  const [modelName, setModelName] = useState("gemini-2.0-flash");
  const [customPrompt, setCustomPrompt] = useState(
    "Ensure grammar, style, and tone are polished. Adjust sentence flow to feel professional yet captivating. Retain specific formatting like line breaks or indentations if relevant."
  );
  const [illustrationStyle, setIllustrationStyle] = useState(
    "A gorgeous digital art book illustration, fantasy realism, soft cinematic lighting, highly detailed"
  );
  
  // Book Metadata State
  const [bookTitle, setBookTitle] = useState("Untranslated Novel");
  const [author, setAuthor] = useState("Becko Hyun");
  const [publisher, setPublisher] = useState("Evvia Publishing");
  const [contact, setContact] = useState("evviacorp@gmail.com");

  // Workflow states
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState("");
  const [splitPattern, setSplitPattern] = useState("(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(-1);
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedPreviewChapter, setSelectedPreviewChapter] = useState<Chapter | null>(null);
  const [coverArtworkUrl, setCoverArtworkUrl] = useState<string | null>(null);
  const [coverArtworkBlob, setCoverArtworkBlob] = useState<Blob | null>(null);
  const [coverStatus, setCoverStatus] = useState<"none" | "generating" | "completed">("none");

  // Visual timers
  const [elapsedTime, setElapsedTime] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  // Authentication check
  useEffect(() => {
    const auth = sessionStorage.getItem("authenticated");
    if (auth === "true") {
      setIsAuthenticated(true);
    }
    
    // Load local storage API key if exists
    const storedKey = localStorage.getItem("gemini_api_key");
    if (storedKey) {
      setApiKey(storedKey);
    }
  }, []);

  // Scroll to bottom of logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Elapsed timer
  useEffect(() => {
    if (isProcessing) {
      setElapsedTime(0);
      timerRef.current = setInterval(() => {
        setElapsedTime(prev => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isProcessing]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminId === "admin" && adminPw === "123jesus") {
      sessionStorage.setItem("authenticated", "true");
      setIsAuthenticated(true);
      addLog("Successfully authenticated as Administrator.", "success");
    } else {
      setLoginError("Invalid Administrator ID or Password.");
    }
  };

  const addLog = (text: string, type: "info" | "success" | "warning" | "error" = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { time, text, type }]);
  };

  const handleSaveSettings = () => {
    localStorage.setItem("gemini_api_key", apiKey);
    setShowSettings(false);
    addLog("Settings saved successfully.", "success");
  };

  // Parse docx file using mammoth
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    const uploadedFile = files[0];
    setFile(uploadedFile);
    addLog(`Reading file: ${uploadedFile.name}...`, "info");

    try {
      const arrayBuffer = await uploadedFile.arrayBuffer();
      // Mammoth extracts raw text, which preserves line breaks nicely
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      setRawText(text);

      // Guess book title from first non-empty lines
      const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      if (lines.length > 0) {
        setBookTitle(lines[0].substring(0, 80));
      }

      addLog(`File successfully parsed. Total characters: ${text.length.toLocaleString()}`, "success");
      
      // Initial split trigger
      splitManuscript(text, splitPattern);
    } catch (err: any) {
      console.error(err);
      addLog(`Failed to parse docx file: ${err.message}`, "error");
    }
  };

  // Perform split based on regex pattern
  const splitManuscript = (text: string, pattern: string) => {
    if (!text) return;
    addLog(`Splitting manuscript using pattern: "${pattern}"...`, "info");

    try {
      const regex = new RegExp(pattern, "m");
      // Split the text while keeping delimiters in the resulting chunks is tricky. 
      // If we use lookahead, e.g. `(?=...)`, the delimiter stays at the start of the next chunk.
      const rawChunks = text.split(regex);
      
      // Clean up and construct chapters
      const parsedChapters: Chapter[] = [];
      let indexCounter = 1;

      rawChunks.forEach((chunk) => {
        const trimmedChunk = chunk.trim();
        if (trimmedChunk.length === 0) return;

        // Try to identify a title from the first line
        const lines = trimmedChunk.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        let title = `Chapter ${indexCounter}`;
        
        if (lines.length > 0) {
          // If the first line is short, we can assume it is the title
          if (lines[0].length < 100) {
            title = lines[0];
          }
        }

        parsedChapters.push({
          id: indexCounter,
          title: title,
          originalText: trimmedChunk,
          status: "pending"
        });
        indexCounter++;
      });

      setChapters(parsedChapters);
      addLog(`Detected ${parsedChapters.length} chapters.`, "success");
    } catch (err: any) {
      addLog(`Invalid splitting regex pattern: ${err.message}`, "error");
    }
  };

  const handlePatternChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPattern = e.target.value;
    setSplitPattern(newPattern);
    if (rawText) {
      splitManuscript(rawText, newPattern);
    }
  };

  // Helper to fetch image with CORS bypass
  const fetchImageBlob = async (url: string): Promise<Blob | undefined> => {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.blob();
      }
    } catch (e) {
      console.error("Failed to fetch image blob:", e);
    }
    return undefined;
  };

  // Canvas drawing helper to generate book cover
  const drawCoverCanvas = async (bgBlob: Blob): Promise<Blob> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = URL.createObjectURL(bgBlob);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 1000;
        canvas.height = 1500;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(bgBlob);
          return;
        }

        // Draw cover background with fit cover math
        const imgAspect = img.width / img.height;
        const canvasAspect = canvas.width / canvas.height;
        let drawWidth = canvas.width;
        let drawHeight = canvas.height;
        let offsetX = 0;
        let offsetY = 0;
        
        if (imgAspect > canvasAspect) {
          drawWidth = canvas.height * imgAspect;
          offsetX = -(drawWidth - canvas.width) / 2;
        } else {
          drawHeight = canvas.width / imgAspect;
          offsetY = -(drawHeight - canvas.height) / 2;
        }
        
        ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

        // Gradient overlay
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grad.addColorStop(0, "rgba(0, 0, 0, 0.7)");
        grad.addColorStop(0.35, "rgba(0, 0, 0, 0.25)");
        grad.addColorStop(0.65, "rgba(0, 0, 0, 0.25)");
        grad.addColorStop(1, "rgba(0, 0, 0, 0.8)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Title text rendering with wraps
        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.font = "bold 64px Georgia, serif";
        
        const words = bookTitle.split(" ");
        let line = "";
        const lines: string[] = [];
        const maxWidth = 800;
        const lineHeight = 80;

        for (let n = 0; n < words.length; n++) {
          const testLine = line + words[n] + " ";
          const metrics = ctx.measureText(testLine);
          if (metrics.width > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + " ";
          } else {
            line = testLine;
          }
        }
        lines.push(line);

        let titleY = 320;
        lines.forEach(l => {
          ctx.fillText(l.trim(), canvas.width / 2, titleY);
          titleY += lineHeight;
        });

        // Author
        ctx.font = "italic 36px Georgia, serif";
        ctx.fillStyle = "#e2e8f0";
        ctx.fillText(`By ${author}`, canvas.width / 2, titleY + 60);

        // Publisher
        ctx.font = "bold 26px Helvetica, Arial, sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(publisher.toUpperCase(), canvas.width / 2, canvas.height - 180);

        // Evvia Corp brand
        ctx.font = "18px Helvetica, Arial, sans-serif";
        ctx.fillStyle = "#94a3b8";
        ctx.fillText("EVVIA CORPORATION", canvas.width / 2, canvas.height - 140);

        canvas.toBlob((blob) => {
          resolve(blob || bgBlob);
        }, "image/jpeg", 0.9);
      };
      img.onerror = () => {
        resolve(bgBlob);
      };
    });
  };

  // Run the processing pipeline sequential loop
  const startProcessingPipeline = async () => {
    if (chapters.length === 0) {
      addLog("No chapters to process. Please upload a file first.", "warning");
      return;
    }

    setIsProcessing(true);
    addLog("Starting sequential processing pipeline...", "info");

    let previousSummary = "";
    const updatedChapters = [...chapters];

    // Step 1: Generate Cover Art based on the Book title & synopsis
    setCoverStatus("generating");
    addLog("Generating Book Cover design prompt using Gemini...", "info");
    
    // Quick prompt to Gemini to get a cover design description
    let coverArtPrompt = `A stunning professional book cover illustration for a story titled "${bookTitle}" by ${author}.`;
    
    try {
      const coverPromptRes = await fetch("/api/refine", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterText: `Book Title: ${bookTitle}\nAuthor: ${author}\nPublisher: ${publisher}`,
          chapterIndex: 0,
          totalChapters: chapters.length,
          previousSummary: `Please describe a visual book cover concept for a novel with this title. Only return a short JSON containing "refinedText" (unused), "summary" (unused), and "illustrationPrompt" containing a highly detailed image generation prompt.`,
          apiKey: apiKey,
          modelName: modelName
        })
      });

      if (coverPromptRes.ok) {
        const coverPromptJson = await coverPromptRes.json();
        if (coverPromptJson.illustrationPrompt) {
          coverArtPrompt = coverPromptJson.illustrationPrompt;
          addLog(`Gemini Cover Prompt: "${coverArtPrompt.substring(0, 100)}..."`, "info");
        }
      }
    } catch (err) {
      console.warn("Cover prompt generation failed, falling back to default.", err);
    }

    try {
      addLog("Fetching cover artwork background from Pollinations.ai...", "info");
      const cleanPrompt = `${coverArtPrompt}, ${illustrationStyle}`;
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(cleanPrompt)}?width=1000&height=1500&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
      
      const blob = await fetchImageBlob(imageUrl);
      if (blob) {
        addLog("Drawing typographic overlay on Cover canvas...", "info");
        const compositeCoverBlob = await drawCoverCanvas(blob);
        setCoverArtworkBlob(compositeCoverBlob);
        setCoverArtworkUrl(URL.createObjectURL(compositeCoverBlob));
        setCoverStatus("completed");
        addLog("Book Cover successfully created.", "success");
      } else {
        setCoverStatus("none");
        addLog("Failed to generate cover artwork background.", "warning");
      }
    } catch (err: any) {
      setCoverStatus("none");
      addLog(`Failed to build cover: ${err.message}`, "error");
    }

    // Step 2: Sequential Chapter Refinement and Illustration Generation
    for (let i = 0; i < updatedChapters.length; i++) {
      setCurrentChapterIndex(i);
      const ch = updatedChapters[i];
      addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Starting refinement...`, "info");
      
      updatedChapters[i] = { ...ch, status: "processing" };
      setChapters([...updatedChapters]);

      try {
        // Send chapter text to api
        const res = await fetch("/api/refine", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chapterText: ch.originalText,
            chapterIndex: i + 1,
            totalChapters: updatedChapters.length,
            previousSummary,
            customPrompt,
            apiKey,
            modelName
          })
        });

        if (!res.ok) {
          const errData = await res.json();
          throw new Error(errData.error || `HTTP error ${res.status}`);
        }

        const data = await res.json();
        
        // Update summary context
        previousSummary = data.summary || previousSummary;
        
        updatedChapters[i].refinedText = data.refinedText;
        updatedChapters[i].summary = data.summary;
        updatedChapters[i].illustrationPrompt = data.illustrationPrompt;
        
        addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Refinement complete. Summary: "${data.summary?.substring(0, 80)}..."`, "success");

        // Generate chapter illustration
        if (data.illustrationPrompt) {
          addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Generating illustration for prompt: "${data.illustrationPrompt.substring(0, 80)}..."`, "info");
          const chPrompt = `${data.illustrationPrompt}, ${illustrationStyle}`;
          const illustrationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(chPrompt)}?width=800&height=600&nologo=true&seed=${Math.floor(Math.random() * 1000000)}`;
          
          updatedChapters[i].illustrationUrl = illustrationUrl;
          
          // Prefetch blob
          const blob = await fetchImageBlob(illustrationUrl);
          if (blob) {
            updatedChapters[i].illustrationBlob = blob;
            addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Illustration cached successfully.`, "success");
          } else {
            addLog(`[Chapter ${i + 1}/${updatedChapters.length}] Failed to download illustration blob (will retry on EPUB compile).`, "warning");
          }
        }

        updatedChapters[i].status = "completed";
        setChapters([...updatedChapters]);

      } catch (err: any) {
        console.error(err);
        updatedChapters[i].status = "failed";
        setChapters([...updatedChapters]);
        addLog(`[Chapter ${i + 1}] Processing failed: ${err.message}`, "error");
        
        // Stop sequential execution on error to preserve integrity
        addLog("Sequential pipeline halted due to error. Please resolve and resume.", "error");
        setIsProcessing(false);
        return;
      }
    }

    addLog("All chapters refined and illustrations generated successfully!", "success");
    setIsProcessing(false);
  };

  // Compile and trigger file download
  const handleDownloadEpub = async () => {
    addLog("Compiling final EPUB package...", "info");
    try {
      const epubMetadata = {
        title: bookTitle,
        author: author,
        publisher: publisher,
        contact: contact,
        coverBlob: coverArtworkBlob || undefined
      };

      const epubChapters = chapters.map(ch => ({
        title: ch.title,
        content: ch.refinedText || ch.originalText,
        illustrationUrl: ch.illustrationUrl,
        illustrationBlob: ch.illustrationBlob
      }));

      const epubBlob = await generateEpub(epubMetadata, epubChapters);
      
      // Trigger download
      const url = URL.createObjectURL(epubBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.epub`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      addLog("EPUB ebook downloaded successfully!", "success");
    } catch (err: any) {
      console.error(err);
      addLog(`Failed to compile EPUB: ${err.message}`, "error");
    }
  };

  const formatSeconds = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Render Login Panel
  if (!isAuthenticated) {
    return (
      <div className="login-wrapper">
        <div className="glass login-card">
          <div className="logo-header">
            <span className="logo-badge">Evvia Publishing</span>
            <h1>EPUB BOOK MAKER</h1>
            <p>Access the editorial and text correction dashboard.</p>
          </div>
          
          <form onSubmit={handleLogin} className="login-form">
            <div className="input-group">
              <label>Administrator ID</label>
              <input 
                type="text" 
                className="input-field" 
                value={adminId}
                onChange={e => setAdminId(e.target.value)}
                placeholder="Enter ID"
                required
              />
            </div>
            
            <div className="input-group">
              <label>Password</label>
              <input 
                type="password" 
                className="input-field" 
                value={adminPw}
                onChange={e => setAdminPw(e.target.value)}
                placeholder="Enter password"
                required
              />
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
            background: radial-gradient(circle at center, #10101b 0%, #050508 100%);
          }
          .login-card {
            max-width: 420px;
            width: 100%;
            padding: 40px;
          }
          .logo-header {
            text-align: center;
            margin-bottom: 32px;
          }
          .logo-badge {
            background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
            color: #050508;
            font-size: 11px;
            font-weight: 800;
            padding: 4px 10px;
            border-radius: 9999px;
            text-transform: uppercase;
            letter-spacing: 1px;
            display: inline-block;
            margin-bottom: 12px;
          }
          h1 {
            font-size: 24px;
            letter-spacing: -0.5px;
            margin-bottom: 8px;
            font-weight: 700;
          }
          p {
            color: var(--foreground-muted);
            font-size: 14px;
          }
          .login-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
          }
          .input-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
          }
          label {
            font-size: 12px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: var(--foreground-muted);
          }
          .error-text {
            color: var(--danger);
            font-size: 13px;
            text-align: center;
            margin: 0;
          }
        `}</style>
      </div>
    );
  }

  // Render Dashboard
  const completedChaptersCount = chapters.filter(c => c.status === "completed").length;
  const progressPercent = chapters.length > 0 ? Math.round((completedChaptersCount / chapters.length) * 100) : 0;

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
            <button className="btn-secondary" onClick={() => setShowSettings(true)}>
              ⚙️ Settings
            </button>
            <button className="btn-secondary" onClick={() => {
              sessionStorage.removeItem("authenticated");
              setIsAuthenticated(false);
            }}>
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="container main-content">
        {/* Left Control Column */}
        <div className="control-col">
          {/* Section 1: Book Info */}
          <section className="glass section-card">
            <h3>📖 Book Metadata</h3>
            <div className="metadata-form">
              <div className="form-row-2">
                <div className="form-group">
                  <label>Title</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={bookTitle}
                    onChange={e => setBookTitle(e.target.value)}
                    placeholder="Enter Book Title"
                  />
                </div>
                <div className="form-group">
                  <label>Author</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={author}
                    onChange={e => setAuthor(e.target.value)}
                    placeholder="Author Name"
                  />
                </div>
              </div>
              <div className="form-row-2">
                <div className="form-group">
                  <label>Publisher</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={publisher}
                    onChange={e => setPublisher(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Publisher Contact</label>
                  <input 
                    type="text" 
                    className="input-field" 
                    value={contact}
                    onChange={e => setContact(e.target.value)}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Section 2: Upload File & Chapters Splitter */}
          <section className="glass section-card">
            <h3>📂 Upload Manuscript</h3>
            
            <div className="upload-dropzone">
              <input 
                type="file" 
                id="file-upload" 
                accept=".docx"
                onChange={handleFileUpload} 
                className="hidden-file-input"
              />
              <label htmlFor="file-upload" className="dropzone-label">
                <div className="upload-icon">📄</div>
                {file ? (
                  <span className="file-name">{file.name}</span>
                ) : (
                  <span>Drag & Drop your <strong>.docx</strong> file here, or click to browse</span>
                )}
              </label>
            </div>

            {rawText && (
              <div className="split-config" style={{ marginTop: "20px" }}>
                <div className="form-group">
                  <label>Regex Splitting Pattern (Delimiters)</label>
                  <input 
                    type="text" 
                    className="input-field font-mono" 
                    value={splitPattern}
                    onChange={handlePatternChange}
                  />
                  <small className="help-text">
                    Splits the novel when matching headings. Uses regex lookahead to keep titles.
                  </small>
                </div>

                {/* Preset badges */}
                <div className="presets-list">
                  <button className="badge-btn" onClick={() => {
                    setSplitPattern("(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])");
                    splitManuscript(rawText, "(?=^Chapter\\s+\\d+|^\\bChapter\\b\\s+[IVXLCDM]+|^제\\s*\\d+\\s*[장화])");
                  }}>English/Korean Standard</button>
                  
                  <button className="badge-btn" onClick={() => {
                    setSplitPattern("(?=^#[^#])");
                    splitManuscript(rawText, "(?=^#[^#])");
                  }}>Markdown H1 (#)</button>

                  <button className="badge-btn" onClick={() => {
                    setSplitPattern("(?=^ACT\\s+\\d+)");
                    splitManuscript(rawText, "(?=^ACT\\s+\\d+)");
                  }}>Acts Split</button>
                </div>
              </div>
            )}
          </section>

          {/* Section 3: Processing & Operations */}
          {chapters.length > 0 && (
            <section className="glass section-card">
              <h3>⚡ Engine Operations</h3>

              {!isProcessing && completedChaptersCount < chapters.length && (
                <button className="btn-primary" onClick={startProcessingPipeline} style={{ width: "100%" }}>
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
                    <div className="progress-bar-fill" style={{ width: `${progressPercent}%` }}></div>
                  </div>
                  <p className="active-task-text">
                    Processing: {chapters[currentChapterIndex]?.title || "Preparing..."}
                  </p>
                </div>
              )}

              {completedChaptersCount > 0 && !isProcessing && (
                <div className="download-area">
                  <div className="alert-box success">
                    <span>✓ Polished {completedChaptersCount}/{chapters.length} Chapters successfully.</span>
                  </div>
                  <button className="btn-primary" onClick={handleDownloadEpub} style={{ width: "100%", marginTop: "12px" }}>
                    📥 Compile & Download EPUB
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Section 4: Logs Console */}
          <section className="glass section-card console-card">
            <div className="console-header">
              <h3>💻 Operation Logs</h3>
              <button className="btn-clear-logs" onClick={() => setLogs([])}>Clear</button>
            </div>
            
            <div className="console-display">
              {logs.length === 0 ? (
                <p className="empty-logs">Ready. Upload manuscript to begin operation logs.</p>
              ) : (
                logs.map((log, index) => (
                  <div key={index} className={`log-line ${log.type}`}>
                    <span className="log-time">[{log.time}]</span>
                    <span className="log-text">{log.text}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef}></div>
            </div>
          </section>
        </div>

        {/* Right Output/Preview Column */}
        <div className="preview-col">
          {/* Cover Art Status Card */}
          <section className="glass section-card">
            <h3>🎨 Book Cover Page</h3>
            <div className="cover-preview-wrapper">
              {coverStatus === "none" && (
                <div className="empty-cover">
                  <p>Book Cover artwork will be generated during translation refinement.</p>
                </div>
              )}
              {coverStatus === "generating" && (
                <div className="empty-cover shimmer-bg">
                  <div className="spinner"></div>
                  <p style={{ marginTop: "12px" }}>Generating custom cover artwork...</p>
                </div>
              )}
              {coverStatus === "completed" && coverArtworkUrl && (
                <div className="cover-canvas-container">
                  <img src={coverArtworkUrl} className="cover-canvas-image" alt="Ebook Cover Preview" />
                  <div className="cover-overlay-info">
                    <p>Publisher: {publisher}</p>
                    <p>Author: {author}</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Chapters List and Previews */}
          <section className="glass section-card chapters-list-card">
            <h3>📑 Chapter Outputs ({chapters.length})</h3>
            
            <div className="chapters-grid">
              {chapters.map((ch, idx) => (
                <div 
                  key={ch.id} 
                  className={`chapter-item ${ch.status} ${selectedPreviewChapter?.id === ch.id ? "active" : ""}`}
                  onClick={() => setSelectedPreviewChapter(ch)}
                >
                  <div className="chapter-meta">
                    <span className="chapter-num">#{ch.id}</span>
                    <span className="chapter-words">{(ch.originalText.split(/\s+/).length).toLocaleString()} words</span>
                  </div>
                  <h4 className="chapter-title-text">{ch.title}</h4>
                  
                  <div className="chapter-status-row">
                    <span className="status-badge">{ch.status}</span>
                    {ch.illustrationUrl && <span className="illustration-badge">🎨 Art</span>}
                  </div>
                </div>
              ))}
            </div>

            {chapters.length === 0 && (
              <p className="empty-chapters">No manuscript split yet. Upload a file to see chapters list.</p>
            )}
          </section>

          {/* Chapter Content Preview Modal/Section */}
          {selectedPreviewChapter && (
            <section className="glass section-card preview-content-card">
              <div className="preview-header">
                <h3>🔍 Preview: {selectedPreviewChapter.title}</h3>
                <button className="btn-close-preview" onClick={() => setSelectedPreviewChapter(null)}>Close</button>
              </div>

              <div className="preview-body">
                {selectedPreviewChapter.illustrationUrl && (
                  <div className="preview-art-frame">
                    <img 
                      src={selectedPreviewChapter.illustrationUrl} 
                      alt={`${selectedPreviewChapter.title} Illustration`}
                      className="preview-art-img"
                    />
                    {selectedPreviewChapter.illustrationPrompt && (
                      <p className="art-prompt-caption">
                        <strong>Prompt:</strong> {selectedPreviewChapter.illustrationPrompt}
                      </p>
                    )}
                  </div>
                )}

                <div className="content-comparison">
                  <div className="comparison-pane">
                    <h5>Original Text</h5>
                    <div className="text-pane font-serif">{selectedPreviewChapter.originalText}</div>
                  </div>
                  
                  <div className="comparison-pane">
                    <h5>Refined Text</h5>
                    <div className="text-pane refined-pane font-serif">
                      {selectedPreviewChapter.refinedText ? (
                        selectedPreviewChapter.refinedText
                      ) : (
                        <span className="placeholder-text">Pending refinement processing...</span>
                      )}
                    </div>
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
                <input 
                  type="password" 
                  className="input-field" 
                  value={apiKey} 
                  onChange={e => setApiKey(e.target.value)}
                  placeholder={process.env.GEMINI_API_KEY ? "Using server environment key" : "Enter API Key"}
                />
                <small className="help-text">
                  API Key is saved in local storage securely and never sent to third-parties.
                </small>
              </div>

              <div className="form-group">
                <label>Model Selector</label>
                <select className="input-field" value={modelName} onChange={e => setModelName(e.target.value)}>
                  <option value="gemini-2.0-flash">Gemini 2.0 Flash (Fast, Recommended)</option>
                  <option value="gemini-2.0-flash-lite">Gemini 2.0 Flash Lite (Fastest, Lightest)</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash (Most capable, slower)</option>
                </select>
              </div>

              <div className="form-group">
                <label>Editorial Instructions (System Prompt Modifier)</label>
                <textarea 
                  className="input-field" 
                  rows={4}
                  value={customPrompt} 
                  onChange={e => setCustomPrompt(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Illustration Artistic Style</label>
                <input 
                  type="text" 
                  className="input-field" 
                  value={illustrationStyle} 
                  onChange={e => setIllustrationStyle(e.target.value)}
                />
                <small className="help-text">
                  Appended to chapter prompts to ensure styling consistency.
                </small>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleSaveSettings}>Save Configuration</button>
            </div>
          </div>
        </div>
      )}

      {/* CSS Stylesheet overrides and specific classes */}
      <style jsx>{`
        .dashboard-layout {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          background: #06060a;
          padding-bottom: 60px;
        }

        .header-bar {
          border-radius: 0;
          border-top: none;
          border-left: none;
          border-right: none;
          position: sticky;
          top: 0;
          z-index: 50;
        }

        .header-content {
          height: 70px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .brand-logo {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-badge {
          background: linear-gradient(135deg, var(--primary) 0%, var(--secondary) 100%);
          color: #050508;
          font-size: 10px;
          font-weight: 800;
          padding: 3px 8px;
          border-radius: 9999px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        h2 {
          font-size: 18px;
          font-weight: 700;
          letter-spacing: -0.3px;
        }

        .header-actions {
          display: flex;
          gap: 12px;
        }

        .main-content {
          margin-top: 32px;
          display: grid;
          grid-template-columns: 460px 1fr;
          gap: 28px;
        }

        @media (max-width: 1024px) {
          .main-content {
            grid-template-columns: 1fr;
          }
        }

        .control-col, .preview-col {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .section-card {
          padding: 24px;
        }

        h3 {
          font-size: 15px;
          font-weight: 600;
          margin-bottom: 18px;
          letter-spacing: 0.2px;
          text-transform: uppercase;
          color: var(--foreground-muted);
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
          padding-bottom: 8px;
        }

        .metadata-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-row-2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 11px;
          font-weight: 600;
          color: var(--foreground-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .help-text {
          font-size: 11px;
          color: var(--foreground-muted);
          margin-top: 4px;
        }

        .upload-dropzone {
          border: 2px dashed rgba(255, 255, 255, 0.1);
          border-radius: 12px;
          background: rgba(255, 255, 255, 0.01);
          transition: all var(--transition-fast);
          cursor: pointer;
        }

        .upload-dropzone:hover {
          border-color: var(--primary);
          background: rgba(0, 242, 254, 0.02);
        }

        .hidden-file-input {
          display: none;
        }

        .dropzone-label {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px 24px;
          text-align: center;
          cursor: pointer;
          font-size: 14px;
          color: var(--foreground-muted);
        }

        .upload-icon {
          font-size: 32px;
          margin-bottom: 12px;
        }

        .file-name {
          color: var(--primary);
          font-weight: 600;
        }

        .presets-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 12px;
        }

        .badge-btn {
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: var(--foreground-muted);
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 9999px;
          cursor: pointer;
          transition: all var(--transition-fast);
        }

        .badge-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          color: var(--foreground);
          border-color: var(--primary);
        }

        .progress-container {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .progress-labels {
          display: flex;
          justify-content: space-between;
          font-size: 13px;
          font-weight: 600;
        }

        .progress-bar-bg {
          height: 8px;
          background: rgba(255, 255, 255, 0.05);
          border-radius: 9999px;
          overflow: hidden;
        }

        .progress-bar-fill {
          height: 100%;
          background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%);
          border-radius: 9999px;
          transition: width 0.3s ease;
        }

        .active-task-text {
          font-size: 12px;
          color: var(--primary);
          font-weight: 500;
        }

        .alert-box {
          background: rgba(16, 185, 129, 0.06);
          border: 1px solid rgba(16, 185, 129, 0.15);
          color: var(--success);
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 500;
        }

        /* Console styling */
        .console-card {
          flex-grow: 1;
        }

        .console-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .console-header h3 {
          margin-bottom: 0;
          border-bottom: none;
          padding-bottom: 0;
        }

        .btn-clear-logs {
          background: transparent;
          border: none;
          color: var(--foreground-muted);
          font-size: 11px;
          cursor: pointer;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .btn-clear-logs:hover {
          color: var(--foreground);
        }

        .console-display {
          background: rgba(0, 0, 0, 0.3);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 8px;
          padding: 14px;
          font-family: var(--font-geist-mono), monospace;
          font-size: 12px;
          height: 240px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .empty-logs {
          color: rgba(255, 255, 255, 0.2);
          text-align: center;
          margin-top: 100px;
        }

        .log-line {
          line-height: 1.4;
        }

        .log-time {
          color: var(--foreground-muted);
          margin-right: 8px;
        }

        .log-line.info { color: #cbd5e1; }
        .log-line.success { color: #4ade80; }
        .log-line.warning { color: #facc15; }
        .log-line.error { color: #f87171; }

        /* Cover preview styling */
        .cover-preview-wrapper {
          aspect-ratio: 2/3;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 12px;
          overflow: hidden;
        }

        .empty-cover {
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 40px;
          text-align: center;
          color: var(--foreground-muted);
          font-size: 13px;
        }

        .spinner {
          width: 32px;
          height: 32px;
          border: 3px solid rgba(0, 242, 254, 0.1);
          border-top-color: var(--primary);
          border-radius: 50%;
          animation: spin 1s infinite linear;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .cover-canvas-container {
          position: relative;
          height: 100%;
          width: 100%;
        }

        .cover-canvas-image {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .cover-overlay-info {
          position: absolute;
          bottom: 12px;
          right: 12px;
          background: rgba(0, 0, 0, 0.7);
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 11px;
          color: #cbd5e1;
          pointer-events: none;
        }

        /* Chapters list styling */
        .chapters-list-card {
          flex-grow: 1;
        }

        .chapters-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
          gap: 12px;
          max-height: 380px;
          overflow-y: auto;
          padding-right: 4px;
        }

        .chapter-item {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 8px;
          padding: 12px;
          cursor: pointer;
          transition: all var(--transition-fast);
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .chapter-item:hover {
          background: rgba(255, 255, 255, 0.04);
          border-color: var(--primary);
        }

        .chapter-item.active {
          background: rgba(0, 242, 254, 0.04);
          border-color: var(--primary);
          box-shadow: 0 0 10px rgba(0, 242, 254, 0.1);
        }

        .chapter-meta {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          color: var(--foreground-muted);
        }

        .chapter-num {
          font-weight: bold;
          color: var(--primary);
        }

        .chapter-title-text {
          font-size: 12px;
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .chapter-status-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 9px;
          margin-top: auto;
        }

        .status-badge {
          text-transform: uppercase;
          font-weight: 700;
        }

        .pending .status-badge { color: var(--foreground-muted); }
        .processing .status-badge { color: var(--secondary); animation: pulse-glow 1s infinite; }
        .completed .status-badge { color: var(--success); }
        .failed .status-badge { color: var(--danger); }

        .illustration-badge {
          background: rgba(251, 194, 235, 0.15);
          color: var(--accent);
          padding: 1px 4px;
          border-radius: 3px;
          font-weight: 600;
        }

        .empty-chapters {
          text-align: center;
          padding: 40px;
          color: var(--foreground-muted);
          font-size: 13px;
        }

        /* Preview card styling */
        .preview-content-card {
          margin-top: 12px;
        }

        .preview-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }

        .preview-header h3 {
          margin-bottom: 0;
          border-bottom: none;
          padding-bottom: 0;
        }

        .btn-close-preview {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: var(--foreground);
          font-size: 11px;
          padding: 4px 12px;
          border-radius: 6px;
          cursor: pointer;
        }

        .btn-close-preview:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .preview-body {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .preview-art-frame {
          display: flex;
          flex-direction: column;
          align-items: center;
          background: rgba(0, 0, 0, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 8px;
          padding: 12px;
        }

        .preview-art-img {
          max-width: 100%;
          max-height: 300px;
          border-radius: 6px;
          object-fit: contain;
        }

        .art-prompt-caption {
          font-size: 11px;
          color: var(--foreground-muted);
          margin-top: 8px;
          text-align: center;
          max-width: 600px;
        }

        .content-comparison {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        @media (max-width: 768px) {
          .content-comparison {
            grid-template-columns: 1fr;
          }
        }

        .comparison-pane {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .comparison-pane h5 {
          font-size: 11px;
          color: var(--foreground-muted);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .text-pane {
          background: rgba(0, 0, 0, 0.25);
          border: 1px solid rgba(255, 255, 255, 0.04);
          border-radius: 8px;
          padding: 16px;
          font-size: 13px;
          line-height: 1.6;
          max-height: 300px;
          overflow-y: auto;
          white-space: pre-wrap;
        }

        .refined-pane {
          border-color: rgba(0, 242, 254, 0.1);
        }

        .placeholder-text {
          color: var(--foreground-muted);
          font-style: italic;
        }

        /* Settings modal styling */
        .modal-backdrop {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(8px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
          padding: 24px;
        }

        .modal-card {
          max-width: 500px;
          width: 100%;
          padding: 28px;
        }

        .modal-card h3 {
          margin-bottom: 20px;
        }

        .modal-body {
          display: flex;
          flex-direction: column;
          gap: 16px;
          margin-bottom: 24px;
        }

        .modal-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }
      `}</style>
    </div>
  );
}
