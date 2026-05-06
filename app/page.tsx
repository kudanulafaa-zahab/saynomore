export default function Home() {
  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="glass max-w-md w-full p-10 text-center space-y-6">
        {/* Logo mark */}
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl"
          style={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", boxShadow: "0 8px 32px rgba(99,102,241,0.35)" }}>
          <span className="text-2xl font-bold text-white">S</span>
        </div>

        {/* Wordmark */}
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-white">SayNoMore</h1>
          <p className="text-sm text-white/50">FMCG Import &amp; Distribution</p>
        </div>

        {/* Status */}
        <div className="glass-flat rounded-xl px-4 py-3">
          <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Status</p>
          <p className="text-sm text-white/80">Project initialised — ready to build</p>
        </div>

        {/* SKU hierarchy preview */}
        <div className="glass-flat rounded-xl px-4 py-4 text-left space-y-1">
          <p className="text-xs text-white/40 uppercase tracking-widest mb-2">SKU Hierarchy</p>
          {["Brand", "Category", "Variant", "Packaging", "Unit Size", "Units / Pack", "Packs / Carton"].map((level, i) => (
            <div key={level} className="flex items-center gap-2">
              <span className="text-xs text-white/20" style={{ paddingLeft: `${i * 10}px` }}>{"└"}</span>
              <span className="text-xs text-white/70">{level}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
