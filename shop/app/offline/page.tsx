export default function OfflinePage() {
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 text-center">
      <div>
        <div className="text-4xl mb-3">📶</div>
        <h1 className="ios-title2 font-semibold mb-2">You&apos;re offline</h1>
        <p className="ios-subhead" style={{ color: "var(--muted-foreground)" }}>
          Reconnect to browse the shop. Your cart is saved on this device.
        </p>
      </div>
    </main>
  );
}
