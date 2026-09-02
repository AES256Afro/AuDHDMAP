import { useEffect } from "react";

const features = [
  { symbol: "⌘", title: "Freeform canvas", copy: "Drop thoughts anywhere, connect them later, and let the structure emerge at your pace." },
  { symbol: "☷", title: "Outline in one click", copy: "Move between spatial thinking and a clean hierarchical document without rebuilding your work." },
  { symbol: "◎", title: "Branch focus", copy: "Isolate one branch, keep its context, and hide everything that is not useful right now." },
  { symbol: "▦", title: "Thoughts become projects", copy: "Add task status, priority, dates, progress, milestones, Board, Timeline, and Gantt views." },
  { symbol: "⌨", title: "Keyboard first", copy: "Capture, branch, outdent, search, focus, undo, and jump between ideas without leaving the keyboard." },
  { symbol: "◫", title: "Predictable layouts", copy: "Snap to a strict grid or apply tree and grid layouts when a crowded map needs order." },
  { symbol: "◉", title: "Sensory controls", copy: "Choose quiet, signal-green, amber CRT, workstation, or paper themes with motion and intensity controls." },
  { symbol: "⇩", title: "Your data leaves cleanly", copy: "Export PDF, SVG, Markdown, text, project CSV, JSON, or a complete attachment-safe ZIP backup." },
];

export function LandingPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = "AuDHDMAP | Visual thinking without the noise";
    if (description) description.content = "A private, self-hosted mind mapping and note-taking workspace built for non-linear thinking, calm focus, and clean export.";
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return <div className="site-page">
    <header className="site-nav">
      <a className="site-brand" href="#top" aria-label="AuDHDMAP home"><span>⌘</span><strong>AuDHDMAP</strong><small>VISUAL THINKING SYSTEM</small></a>
      <nav aria-label="Website"><a href="#features">Features</a><a href="#screens">Screens</a><a href="#self-host">Self-host</a><a href="https://github.com/AES256Afro/AuDHDMAP">GitHub</a></nav>
      <a className="site-button small" href="/demo">Launch demo <span aria-hidden="true">↗</span></a>
    </header>

    <main id="top">
      <section className="site-hero">
        <div className="site-hero-copy">
          <div className="site-kicker"><i /> PUBLIC BUILD ONLINE <span>V0.7</span></div>
          <h1>Map the way your mind <em>actually moves.</em></h1>
          <p>Capture the thought before it disappears. Organize it when you are ready. AuDHDMAP turns a freeform canvas into outlines, projects, timelines, and clean exports without forcing your brain into one rigid shape.</p>
          <div className="site-actions"><a className="site-button" href="/demo">Open the live demo <span aria-hidden="true">↗</span></a><a className="site-text-link" href="#screens">See how it works <span aria-hidden="true">↓</span></a></div>
          <div className="site-proof" aria-label="Product qualities"><span><b>●</b> No account for the demo</span><span><b>●</b> Docker ready</span><span><b>●</b> Private by default</span></div>
        </div>
        <div className="site-hero-screen">
          <div className="screen-frame"><div className="screen-bar"><span>AuDHDMAP / CANVAS</span><i /><i /><i /></div><img src="/site/canvas-map.jpg" alt="AuDHDMAP signal-green canvas showing a connected home server project map" /></div>
          <div className="screen-readout"><span>MODE: SIGNAL GARDEN</span><span>GRID: 16 PX</span><span>STATUS: READY</span></div>
        </div>
      </section>

      <section className="site-metrics" aria-label="Product summary">
        <article><strong>05</strong><span>ways to see the same work</span></article>
        <article><strong>07</strong><span>portable export formats</span></article>
        <article><strong>10K</strong><span>thoughts in the performance gate</span></article>
        <article><strong>01</strong><span>container owns the whole workspace</span></article>
      </section>

      <section className="site-section" id="features">
        <header className="site-section-heading"><div><span className="site-label">CORE SYSTEMS</span><h2>Less friction between thought and structure.</h2></div><p>Every feature is there to make capturing easier, context clearer, and recovery less frightening.</p></header>
        <div className="site-feature-grid">{features.map((feature, index) => <article key={feature.title}><span className="feature-number">{String(index + 1).padStart(2, "0")}</span><i>{feature.symbol}</i><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
      </section>

      <section className="site-section site-screens" id="screens">
        <header className="site-section-heading"><div><span className="site-label">ONE MAP, MANY MODES</span><h2>Spatial when you need it. Linear when you do not.</h2></div><p>The data stays the same while the view changes around your task.</p></header>
        <div className="screen-story">
          <article className="screen-story-copy"><span>01 / CANVAS</span><h3>Think before you format.</h3><p>Place ideas freely, connect related thoughts, draw stable boundaries, then apply an orderly layout only when it helps.</p><ul><li>Free pan and zoom</li><li>Tree and grid auto-layout</li><li>Cross-map references</li><li>Strict Branch Focus</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>SPATIAL WORKSPACE</span><i /><i /><i /></div><img src="/site/canvas-map.jpg" alt="Freeform AuDHDMAP canvas with linked thoughts and a details inspector" /></div>
        </div>
        <div className="screen-story reverse">
          <article className="screen-story-copy"><span>02 / OUTLINE</span><h3>Turn the same map into a document.</h3><p>Edit titles in a predictable hierarchy, collapse branches, and keep references visible without losing the original spatial map.</p><ul><li>Instant map-to-outline switch</li><li>Inline title editing</li><li>Collapsed branch counts</li><li>Project-ready hierarchy</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>LINEAR WORKSPACE</span><i /><i /><i /></div><img src="/site/outline-view.jpg" alt="AuDHDMAP outline view showing the same project as a clean hierarchy" /></div>
        </div>
        <div className="screen-story">
          <article className="screen-story-copy"><span>03 / EXPORT</span><h3>Leave with useful files, not a hostage format.</h3><p>Share what is visible, hand a project to a spreadsheet, or back up the entire workspace with its attachments and integrity checks.</p><ul><li>Visual PDF plus readable outline</li><li>SVG, Markdown, and plain text</li><li>Project CSV and JSON</li><li>Complete ZIP backup and restore</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>PORTABLE BY DESIGN</span><i /><i /><i /></div><img src="/site/export-panel.jpg" alt="AuDHDMAP export panel with PDF, SVG, Markdown, text, and project CSV choices" /></div>
        </div>
      </section>

      <section className="site-section sensory-section">
        <div><span className="site-label">SENSORY CONTROL</span><h2>Calm is a setting, not an assumption.</h2><p>Choose the environment your eyes and attention can work with today. Theme, contrast, brightness, saturation, branch font, node shape, line weight, grid behavior, motion, and CRT effects are all adjustable.</p></div>
        <div className="theme-console" aria-label="Available themes"><article className="theme-quiet"><i /><strong>Quiet canvas</strong><small>LOW STIMULUS</small></article><article className="theme-signal"><i /><strong>Signal garden</strong><small>GREEN CRT</small></article><article className="theme-amber"><i /><strong>Amber operator</strong><small>WARM CRT</small></article><article className="theme-workstation"><i /><strong>Workstation 84</strong><small>RETRO DESKTOP</small></article><article className="theme-paper"><i /><strong>Paper atlas</strong><small>LIGHT READING</small></article></div>
      </section>

      <section className="site-section self-host-section" id="self-host">
        <div className="self-host-copy"><span className="site-label">YOUR SERVER, YOUR NOTES</span><h2>Private by default. Portable on purpose.</h2><p>AuDHDMAP runs as one Docker container with one durable data volume. Install through BoxPilot or use Docker Compose. There is no required cloud account, analytics service, or proprietary sync layer.</p><div className="site-actions"><a className="site-button" href="https://github.com/AES256Afro/AuDHDMAP#run-with-docker-compose">Install with Docker</a><a className="site-text-link" href="https://github.com/AES256Afro/BoxPilot">View BoxPilot</a></div></div>
        <div className="terminal-card"><header><span>BOXPILOT / APP CATALOGUE</span><b>● READY</b></header><pre><code><span>$</span> docker compose up -d{`\n\n`}✓ private owner login{`\n`}✓ persistent /data volume{`\n`}✓ built-in health check{`\n`}✓ complete ZIP recovery{`\n`}✓ amd64 + arm64 images</code></pre><footer>NO THIRD-PARTY ACCOUNT REQUIRED</footer></div>
      </section>

      <section className="site-final-cta"><span className="site-label">THE SANDBOX IS OPEN</span><h2>Put a few thoughts down.<br />See where they connect.</h2><p>The public demo is shared, temporary, and passwordless. Use it for exploration. Keep real work in a private BoxPilot or Docker installation.</p><a className="site-button" href="/demo">Launch AuDHDMAP <span aria-hidden="true">↗</span></a></section>
    </main>

    <footer className="site-footer"><a className="site-brand" href="#top"><span>⌘</span><strong>AuDHDMAP</strong></a><p>Visual thinking without the noise.</p><nav><a href="https://github.com/AES256Afro/AuDHDMAP">Source</a><a href="https://github.com/AES256Afro/AuDHDMAP/blob/main/docs/SECURITY.md">Security</a><a href="/demo">Demo</a></nav></footer>
    <div className="site-scanlines" aria-hidden="true" />
  </div>;
}
