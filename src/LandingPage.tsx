import { useEffect } from "react";

const features = [
  { symbol: "⌘", title: "Canvas", copy: "Place thoughts freely, move them, connect them, and group branches inside labeled boundaries." },
  { symbol: "☷", title: "Outline", copy: "View and edit the same map as an indented text hierarchy. Branches can be collapsed." },
  { symbol: "◎", title: "Branch focus", copy: "Show one branch, its parents, its children, and direct references. Hide unrelated nodes." },
  { symbol: "▦", title: "Project fields", copy: "Add status, priority, start date, due date, progress, and milestones to any thought." },
  { symbol: "⌨", title: "Keyboard controls", copy: "Create, branch, outdent, search, focus, undo, and switch locations from the keyboard." },
  { symbol: "◫", title: "Layouts and grid", copy: "Snap manual movement to a grid or apply tree and grid layouts to the current map." },
  { symbol: "◉", title: "Display settings", copy: "Select one of five themes and adjust brightness, saturation, font, shape, line width, motion, and CRT effects." },
  { symbol: "⇩", title: "Export and backup", copy: "Export PDF, SVG, Markdown, text, CSV, or JSON. Private installations also create complete ZIP backups." },
];

export function LandingPage() {
  useEffect(() => {
    const previousTitle = document.title;
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    const previousDescription = description?.content;
    document.title = "AuDHDMAP | Self-hosted mind mapping and notes";
    if (description) description.content = "A self-hosted mind mapping and note-taking application for Docker and BoxPilot.";
    return () => {
      document.title = previousTitle;
      if (description && previousDescription) description.content = previousDescription;
    };
  }, []);

  return <div className="site-page">
    <header className="site-nav">
      <a className="site-brand" href="#top" aria-label="AuDHDMAP home"><span>⌘</span><strong>AuDHDMAP</strong><small>MIND MAPPING + NOTES</small></a>
      <nav aria-label="Website"><a href="#features">Features</a><a href="#screens">Screens</a><a href="#self-host">Self-host</a><a href="https://github.com/AES256Afro/AuDHDMAP">GitHub</a></nav>
      <a className="site-button small" href="/demo">Launch demo <span aria-hidden="true">↗</span></a>
    </header>

    <main id="top">
      <section className="site-hero">
        <div className="site-hero-copy">
          <div className="site-kicker"><i /> VERSION 0.7.1 <span>PUBLIC DEMO</span></div>
          <h1>Self-hosted mind mapping <em>and notes.</em></h1>
          <p>AuDHDMAP runs in one Docker container. It provides Canvas, Outline, Board, Timeline, and Gantt views over the same workspace data.</p>
          <div className="site-actions"><a className="site-button" href="/demo">Open demo <span aria-hidden="true">↗</span></a><a className="site-text-link" href="https://github.com/AES256Afro/AuDHDMAP">Source code <span aria-hidden="true">↗</span></a></div>
          <div className="site-proof" aria-label="Product details"><span><b>●</b> Passwordless demo</span><span><b>●</b> Docker image</span><span><b>●</b> Server storage</span></div>
        </div>
        <div className="site-hero-screen">
          <div className="screen-frame"><div className="screen-bar"><span>AuDHDMAP / CANVAS</span><i /><i /><i /></div><img src="/site/canvas-map.jpg" alt="AuDHDMAP signal-green canvas showing a connected home server project map" /></div>
          <div className="screen-readout"><span>MODE: SIGNAL GARDEN</span><span>GRID: 16 PX</span><span>STATUS: READY</span></div>
        </div>
      </section>

      <section className="site-metrics" aria-label="Product summary">
        <article><strong>05</strong><span>workspace views</span></article>
        <article><strong>07</strong><span>export types</span></article>
        <article><strong>10K</strong><span>thoughts tested</span></article>
        <article><strong>01</strong><span>persistent data volume</span></article>
      </section>

      <section className="site-section" id="features">
        <header className="site-section-heading"><div><span className="site-label">FEATURES</span><h2>Workspace functions</h2></div><p>The same saved workspace is used in every view and export.</p></header>
        <div className="site-feature-grid">{features.map((feature, index) => <article key={feature.title}><span className="feature-number">{String(index + 1).padStart(2, "0")}</span><i>{feature.symbol}</i><h3>{feature.title}</h3><p>{feature.copy}</p></article>)}</div>
      </section>

      <section className="site-section site-screens" id="screens">
        <header className="site-section-heading"><div><span className="site-label">INTERFACE</span><h2>Canvas, outline, and export</h2></div><p>These screenshots were captured from version 0.7.1.</p></header>
        <div className="screen-story">
          <article className="screen-story-copy"><span>01 / CANVAS</span><h3>Canvas view</h3><p>Place, move, connect, and group thoughts on a pan-and-zoom canvas.</p><ul><li>Pan and zoom</li><li>Tree and grid layouts</li><li>Cross-map references</li><li>Branch focus</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>SPATIAL WORKSPACE</span><i /><i /><i /></div><img src="/site/canvas-map.jpg" alt="Freeform AuDHDMAP canvas with linked thoughts and a details inspector" /></div>
        </div>
        <div className="screen-story reverse">
          <article className="screen-story-copy"><span>02 / OUTLINE</span><h3>Outline view</h3><p>Edit the same map as an indented hierarchy. References remain separate from parent and child branches.</p><ul><li>Immediate view switch</li><li>Inline title editing</li><li>Collapsed branches</li><li>Task fields retained</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>LINEAR WORKSPACE</span><i /><i /><i /></div><img src="/site/outline-view.jpg" alt="AuDHDMAP outline view showing the same project as a clean hierarchy" /></div>
        </div>
        <div className="screen-story">
          <article className="screen-story-copy"><span>03 / EXPORT</span><h3>Export panel</h3><p>Export the current map or focused branch. Private installations also provide complete backup and restore.</p><ul><li>PDF with map and outline</li><li>SVG, Markdown, and text</li><li>Project CSV and JSON</li><li>ZIP backup and restore</li></ul></article>
          <div className="screen-frame large"><div className="screen-bar"><span>EXPORT OPTIONS</span><i /><i /><i /></div><img src="/site/export-panel.jpg" alt="AuDHDMAP export panel with PDF, SVG, Markdown, text, and project CSV choices" /></div>
        </div>
      </section>

      <section className="site-section sensory-section">
        <div><span className="site-label">DISPLAY</span><h2>Theme and display settings</h2><p>Select a theme and adjust brightness, saturation, branch font, node shape, line width, grid behavior, motion, and CRT effects.</p></div>
        <div className="theme-console" aria-label="Available themes"><article className="theme-quiet"><i /><strong>Quiet canvas</strong><small>LOW STIMULUS</small></article><article className="theme-signal"><i /><strong>Signal garden</strong><small>GREEN CRT</small></article><article className="theme-amber"><i /><strong>Amber operator</strong><small>WARM CRT</small></article><article className="theme-workstation"><i /><strong>Workstation 84</strong><small>RETRO DESKTOP</small></article><article className="theme-paper"><i /><strong>Paper atlas</strong><small>LIGHT READING</small></article></div>
      </section>

      <section className="site-section self-host-section" id="self-host">
        <div className="self-host-copy"><span className="site-label">DEPLOYMENT</span><h2>Docker and BoxPilot</h2><p>The application uses one container and one persistent `/data` volume. Private installations require an owner password and session secret. No external account is required.</p><div className="site-actions"><a className="site-button" href="https://github.com/AES256Afro/AuDHDMAP#run-with-docker-compose">Docker instructions</a><a className="site-text-link" href="https://github.com/AES256Afro/BoxPilot">BoxPilot source</a></div></div>
        <div className="terminal-card"><header><span>BOXPILOT / APP CATALOGUE</span><b>● READY</b></header><pre><code><span>$</span> docker compose up -d{`\n\n`}✓ private owner login{`\n`}✓ persistent /data volume{`\n`}✓ built-in health check{`\n`}✓ complete ZIP recovery{`\n`}✓ amd64 + arm64 images</code></pre><footer>RUNTIME: DOCKER</footer></div>
      </section>

      <section className="site-final-cta"><span className="site-label">PUBLIC DEMO</span><h2>Shared test workspace</h2><p>No password is required. Data is shared with other visitors and can be reset. Do not enter private information.</p><a className="site-button" href="/demo">Open demo <span aria-hidden="true">↗</span></a></section>
    </main>

    <footer className="site-footer"><a className="site-brand" href="#top"><span>⌘</span><strong>AuDHDMAP</strong></a><p>Version 0.7.1</p><nav><a href="https://github.com/AES256Afro/AuDHDMAP">Source</a><a href="https://github.com/AES256Afro/AuDHDMAP/blob/main/docs/SECURITY.md">Security</a><a href="/demo">Demo</a></nav></footer>
    <div className="site-scanlines" aria-hidden="true" />
  </div>;
}
