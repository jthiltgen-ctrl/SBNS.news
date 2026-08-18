import { useState, useEffect, useCallback } from "react";

const API_URL =
  import.meta.env.VITE_API_URL ||
  'https://www.shockedbutnotsurprised.news/api/published.php';

export default function ShockedButNotSurprised() {
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchStories = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(API_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error("Unexpected response");
      setStories(data);
    } catch {
      setError("The news failed to load. Shocked? Neither are we.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStories();
  }, [fetchStories]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Lora:ital,wght@0,400;0,600;1,400&family=Special+Elite&family=Barlow+Condensed:wght@400;600;700&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        :root {
          --paper: #f2ede3;
          --paper-dark: #e6dfd0;
          --ink: #1a1714;
          --red: #b91c1c;
          --red-dark: #7f1d1d;
          --gray: #6b6560;
          --border: #c8bcaa;
          --kicker-bg: #141210;
        }

        .sbns {
          font-family: 'Lora', Georgia, serif;
          background: var(--paper);
          min-height: 100vh;
          color: var(--ink);
        }

        /* ── HEADER ── */
        .sbns-header {
          background: var(--ink);
          color: var(--paper);
          border-bottom: 5px solid var(--red);
        }

        .sbns-dateline {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 10px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: rgba(242,237,227,0.45);
          padding: 8px 18px;
          border-bottom: 1px solid rgba(255,255,255,0.08);
          display: flex;
          justify-content: space-between;
        }

        .sbns-nameplate {
          padding: 18px 18px 6px;
          text-align: center;
        }

        .sbns-title {
          font-family: 'Bebas Neue', sans-serif;
          font-size: clamp(38px, 10vw, 96px);
          letter-spacing: 1px;
          line-height: 0.95;
          color: var(--paper);
        }

        .sbns-title em {
          color: var(--red);
          font-style: normal;
        }

        .sbns-tagline {
          font-family: 'Special Elite', monospace;
          font-size: clamp(10px, 2.8vw, 13px);
          color: rgba(242,237,227,0.5);
          padding: 8px 18px 18px;
          text-align: center;
          letter-spacing: 0.3px;
          font-style: italic;
        }

        /* ── TOOLBAR ── */
        .sbns-toolbar {
          background: var(--paper-dark);
          border-bottom: 2px solid var(--border);
          padding: 10px 14px;
          display: flex;
          justify-content: flex-end;
          align-items: center;
        }

        .fetch-btn {
          font-family: 'Barlow Condensed', sans-serif;
          font-weight: 700;
          font-size: 13px;
          letter-spacing: 2px;
          text-transform: uppercase;
          background: var(--red);
          color: var(--paper);
          border: none;
          padding: 8px 18px;
          cursor: pointer;
          transition: background 0.12s;
          -webkit-tap-highlight-color: transparent;
          white-space: nowrap;
        }
        .fetch-btn:hover { background: var(--red-dark); }
        .fetch-btn:disabled { background: var(--gray); cursor: not-allowed; }

        /* ── STATES ── */
        .sbns-center {
          padding: 70px 20px;
          text-align: center;
        }

        .sbns-loading-text {
          font-family: 'Special Elite', monospace;
          font-size: 17px;
          color: var(--gray);
          animation: pulse 1.4s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.25; }
        }

        .sbns-empty-head {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 52px;
          color: var(--border);
          margin-bottom: 10px;
        }

        .sbns-empty-sub {
          font-family: 'Special Elite', monospace;
          font-size: 13px;
          color: var(--gray);
          max-width: 320px;
          margin: 0 auto;
          line-height: 1.6;
        }

        .sbns-error {
          margin: 16px;
          border: 2px solid var(--red);
          padding: 14px 18px;
          font-family: 'Special Elite', monospace;
          font-size: 13px;
          color: var(--red);
          background: rgba(185,28,28,0.04);
          text-align: center;
        }

        /* ── GRID ── */
        .sbns-grid {
          padding: 18px 14px 30px;
          display: grid;
          grid-template-columns: 1fr;
          gap: 18px;
          max-width: 960px;
          margin: 0 auto;
        }

        @media (min-width: 580px) {
          .sbns-grid { grid-template-columns: repeat(2, 1fr); }
        }
        @media (min-width: 860px) {
          .sbns-grid { grid-template-columns: repeat(3, 1fr); }
        }

        /* ── CARD ── */
        .story-card {
          border: 1.5px solid var(--border);
          background: var(--paper);
          display: flex;
          flex-direction: column;
          animation: riseIn 0.38s ease both;
          transition: box-shadow 0.18s;
        }

        .story-card:hover { box-shadow: 5px 5px 0 var(--ink); }

        @keyframes riseIn {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        .story-card:nth-child(1) { animation-delay: 0.04s; }
        .story-card:nth-child(2) { animation-delay: 0.09s; }
        .story-card:nth-child(3) { animation-delay: 0.14s; }
        .story-card:nth-child(4) { animation-delay: 0.19s; }
        .story-card:nth-child(5) { animation-delay: 0.24s; }
        .story-card:nth-child(6) { animation-delay: 0.29s; }

        .card-body {
          padding: 13px 14px 11px;
          flex: 1;
        }

        .card-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 9px;
        }

        .cat-badge {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          background: var(--ink);
          color: var(--paper);
          padding: 2px 8px;
        }

        .sev-dots {
          display: flex;
          gap: 3px;
          align-items: center;
        }
        .sev-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--border);
        }
        .sev-dot.on { background: var(--red); }

        .card-headline {
          font-family: 'Bebas Neue', sans-serif;
          font-size: 23px;
          line-height: 1.08;
          letter-spacing: 0.3px;
          color: var(--ink);
          margin-bottom: 9px;
        }

        .card-summary {
          font-size: 12.5px;
          line-height: 1.65;
          color: var(--gray);
        }

        .card-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-top: 10px;
        }

        .tag {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 9px;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          border: 1px solid var(--border);
          padding: 1px 6px;
          color: var(--gray);
        }

        /* ── FML KICKER ── */
        .card-kicker {
          background: var(--kicker-bg);
          border-top: 3px solid var(--red);
          padding: 10px 14px;
        }

        .kicker-label {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 9px;
          letter-spacing: 2.5px;
          text-transform: uppercase;
          color: var(--red);
          margin-bottom: 5px;
        }

        .kicker-text {
          font-family: 'Special Elite', monospace;
          font-size: 12px;
          line-height: 1.55;
          color: rgba(242,237,227,0.8);
          font-style: italic;
        }

        /* ── SOURCE ── */
        .card-source {
          padding: 5px 14px 6px;
          background: var(--paper-dark);
          border-top: 1px solid var(--border);
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 9px;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: var(--gray);
        }

        /* ── FOOTER ── */
        .sbns-footer {
          background: var(--ink);
          border-top: 4px double var(--border);
          padding: 22px 20px;
          text-align: center;
        }

        .footer-body {
          font-family: 'Special Elite', monospace;
          font-size: 11px;
          line-height: 1.9;
          color: rgba(242,237,227,0.4);
        }

        .footer-url {
          font-family: 'Barlow Condensed', sans-serif;
          font-size: 13px;
          letter-spacing: 3px;
          text-transform: uppercase;
          color: var(--red);
          margin-top: 8px;
        }
      `}</style>

      <div className="sbns">

        {/* HEADER */}
        <header className="sbns-header">
          <div className="sbns-dateline">
            <span>Accountability Journalism — Est. 2026</span>
            <span>
              {new Date().toLocaleDateString("en-US", {
                weekday: "short",
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </span>
          </div>
          <div className="sbns-nameplate">
            <div className="sbns-title">
              Shocked<em>,</em> But Not Surprised
            </div>
          </div>
          <div className="sbns-tagline">
            "Another day. Another system that had one job."
          </div>
        </header>

        {/* TOOLBAR */}
        <div className="sbns-toolbar">
          <button
            className="fetch-btn"
            onClick={fetchStories}
            disabled={loading}
          >
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>

        {/* ERROR */}
        {error && <div className="sbns-error">{error}</div>}

        {/* LOADING */}
        {loading && (
          <div className="sbns-center">
            <div className="sbns-loading-text">
              Scanning the wreckage of civil society_
            </div>
          </div>
        )}

        {/* EMPTY */}
        {!loading && !error && stories.length === 0 && (
          <div className="sbns-center">
            <div className="sbns-empty-head">Nothing published yet.</div>
            <div className="sbns-empty-sub">
              The editorial queue is being reviewed. Check back soon.
            </div>
          </div>
        )}

        {/* GRID */}
        {!loading && stories.length > 0 && (
          <div className="sbns-grid">
            {stories.map((story, i) => (
              <div key={i} className="story-card">
                <div className="card-body">
                  <div className="card-meta">
                    <span className="cat-badge">{story.category}</span>
                    <div
                      className="sev-dots"
                      title={`Severity: ${story.severity}/5`}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <div
                          key={n}
                          className={`sev-dot${
                            n <= story.severity ? " on" : ""
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="card-headline">{story.headline}</div>
                  <div className="card-summary">{story.summary}</div>
                  {story.topic_tags?.length > 0 && (
                    <div className="card-tags">
                      {story.topic_tags.map((tag, j) => (
                        <span key={j} className="tag">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card-kicker">
                  <div className="kicker-label">💀 FML Kicker</div>
                  <div className="kicker-text">{story.fml_kicker}</div>
                </div>

                <div className="card-source">via {story.source}</div>
              </div>
            ))}
          </div>
        )}

        {/* FOOTER */}
        <footer className="sbns-footer">
          <div className="footer-body">
            Accountability journalism for a world that keeps surprising us with
            how little it surprises us.
            <br />
            Stories curated by AI. Outrage provided by reality.
          </div>
          <div className="footer-url">www.shockedbutnotsurprised.news</div>
        </footer>
      </div>
    </>
  );
}
