"use client";

import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { NotFoundException } from "@zxing/library";
import { X, Camera } from "lucide-react";

interface BarcodeScannerProps {
  onResult: (code: string) => void;
  onClose: () => void;
  hint?: string;
}

export function BarcodeScanner({ onResult, onClose, hint }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [torch, setTorch] = useState(false);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraIdx, setCameraIdx] = useState(0);
  const resultFired = useRef(false);

  // Prefer the rear camera
  useEffect(() => {
    BrowserMultiFormatReader.listVideoInputDevices()
      .then((devices) => {
        setCameras(devices);
        // Pick back camera by default if available
        const backIdx = devices.findIndex((d) =>
          /back|rear|environment/i.test(d.label)
        );
        if (backIdx !== -1) setCameraIdx(backIdx);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    resultFired.current = false;

    const reader = new BrowserMultiFormatReader();

    const deviceId = cameras[cameraIdx]?.deviceId;
    const constraints: MediaStreamConstraints = {
      video: deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: "environment" },
    };

    reader
      .decodeFromConstraints(constraints, videoRef.current, (result, err) => {
        if (result && !resultFired.current) {
          resultFired.current = true;
          onResult(result.getText());
        }
        if (err && !(err instanceof NotFoundException)) {
          // Suppress frame-by-frame NotFoundException — it's normal between scans
        }
      })
      .catch((e: Error) => {
        if (e.name === "NotAllowedError") {
          setError("Camera permission denied. Please allow camera access in your browser settings.");
        } else if (e.name === "NotFoundError") {
          setError("No camera found on this device.");
        } else {
          setError("Could not start camera. Try closing other apps using it.");
        }
      });

    return () => {
      // Stop all video tracks to release camera
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach((t) => t.stop());
        videoRef.current.srcObject = null;
      }
    };
  }, [cameras, cameraIdx, onResult]);

  async function toggleTorch() {
    if (!videoRef.current) return;
    const stream = videoRef.current.srcObject as MediaStream | null;
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    try {
      // @ts-expect-error — torch not yet in TS MediaTrackConstraints
      await track.applyConstraints({ advanced: [{ torch: !torch }] });
      setTorch((v) => !v);
    } catch {
      // Torch not supported on this device — silently ignore
    }
  }

  function cycleCamera() {
    if (cameras.length < 2) return;
    setCameraIdx((i) => (i + 1) % cameras.length);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[70]"
        style={{ background: "rgba(0,0,0,0.92)" }}
      />

      {/* Scanner card */}
      <div
        className="fixed inset-x-0 bottom-0 z-[71] flex flex-col"
        style={{
          top: 0,
          background: "#000",
          paddingBottom: "env(safe-area-inset-bottom, 24px)",
        }}
      >
        {/* ── Top bar ── */}
        <div
          className="flex items-center justify-between px-5"
          style={{
            paddingTop: "max(20px, env(safe-area-inset-top, 20px))",
            paddingBottom: 16,
          }}
        >
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "rgba(255,255,255,0.5)" }}>
              Scanner
            </p>
            <p className="text-[18px] font-bold text-white leading-tight mt-0.5">
              {hint ?? "Point at a barcode"}
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 44, height: 44, borderRadius: 22,
              background: "rgba(255,255,255,0.12)",
              border: "0.5px solid rgba(255,255,255,0.18)",
              display: "flex", alignItems: "center", justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <X size={18} color="white" />
          </button>
        </div>

        {/* ── Viewfinder ── */}
        <div className="relative flex-1 flex items-center justify-center overflow-hidden">
          {error ? (
            <div className="px-8 text-center space-y-3">
              <div style={{
                width: 64, height: 64, borderRadius: 20,
                background: "var(--snm-brand-muted)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto",
              }}>
                <Camera size={28} color="var(--snm-brand)" />
              </div>
              <p className="text-white text-[15px] font-semibold">{error}</p>
              <button
                onClick={onClose}
                className="h-12 px-6 rounded-2xl text-[14px] font-bold"
                style={{ background: "var(--snm-brand)", color: "var(--snm-brand-on)" }}
              >
                Go back
              </button>
            </div>
          ) : (
            <>
              {/* Live video feed */}
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />

              {/* Aim overlay — darkens edges, clear centre */}
              <div className="absolute inset-0 pointer-events-none">
                {/* Corner bracket lines */}
                {[
                  { top: "20%", left: "10%", borderTop: "3px solid white", borderLeft: "3px solid white", borderRadius: "4px 0 0 0" },
                  { top: "20%", right: "10%", borderTop: "3px solid white", borderRight: "3px solid white", borderRadius: "0 4px 0 0" },
                  { bottom: "20%", left: "10%", borderBottom: "3px solid white", borderLeft: "3px solid white", borderRadius: "0 0 0 4px" },
                  { bottom: "20%", right: "10%", borderBottom: "3px solid white", borderRight: "3px solid white", borderRadius: "0 0 4px 0" },
                ].map((style, i) => (
                  <div key={i} style={{ position: "absolute", width: 28, height: 28, opacity: 0.9, ...style }} />
                ))}

                {/* Scan line animation */}
                <div style={{
                  position: "absolute",
                  left: "10%", right: "10%",
                  top: "50%",
                  height: 2,
                  background: "linear-gradient(90deg, transparent, var(--snm-brand), transparent)",
                  animation: "snm-scan-line 2s ease-in-out infinite",
                  boxShadow: "0 0 8px var(--snm-brand)",
                }} />
              </div>
            </>
          )}
        </div>

        {/* ── Bottom controls ── */}
        {!error && (
          <div
            className="flex items-center justify-center gap-6 px-8"
            style={{ paddingTop: 24, paddingBottom: 8 }}
          >
            {/* Torch toggle */}
            <button
              onClick={toggleTorch}
              style={{
                width: 56, height: 56, borderRadius: 28,
                background: torch ? "white" : "rgba(255,255,255,0.12)",
                border: "0.5px solid rgba(255,255,255,0.20)",
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", flexDirection: "column", gap: 4,
              }}
            >
              {/* Lightning bolt — lucide doesn't have Flashlight, use inline svg */}
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={torch ? "#000" : "white"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
            </button>

            {/* Flip camera — only show if multiple cameras */}
            {cameras.length > 1 && (
              <button
                onClick={cycleCamera}
                style={{
                  width: 56, height: 56, borderRadius: 28,
                  background: "rgba(255,255,255,0.12)",
                  border: "0.5px solid rgba(255,255,255,0.20)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer",
                }}
              >
                <Camera size={22} color="white" />
              </button>
            )}
          </div>
        )}

        {/* Hint strip */}
        {!error && (
          <p
            className="text-center ios-subhead pb-4"
            style={{ color: "rgba(255,255,255,0.45)", paddingTop: 8 }}
          >
            Supports EAN-13, Code 128, QR and most barcodes
          </p>
        )}
      </div>

      <style>{`
        @keyframes snm-scan-line {
          0%   { transform: translateY(-60px); opacity: 0; }
          20%  { opacity: 1; }
          80%  { opacity: 1; }
          100% { transform: translateY(60px); opacity: 0; }
        }
      `}</style>
    </>
  );
}
