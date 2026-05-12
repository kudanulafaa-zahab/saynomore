import React from "react";
import type { LabelData } from "@/lib/queries/labels";

interface Props {
  data: LabelData;
  boatName: string;
  boatJetty: string;
  boatDate: string;
  boatNumber: string;
}

export function DetergentTemplate({ data, boatName, boatJetty, boatDate, boatNumber }: Props) {
  const volumeLabel = data.volumeMl
    ? data.volumeMl >= 1000
      ? `${data.volumeMl / 1000}L`
      : `${data.volumeMl}ml`
    : null;

  return (
    <div className="label-root">
      {/* ── Header ── */}
      <div className="label-header">
        <SaynomoreLogo />
        <p className="tagline">discover . shop . enjoy</p>
      </div>

      {/* ── Product block ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td rowSpan={2} className="icon-cell">
              <BottleIcon />
            </td>
            <td className="product-name-cell" colSpan={2}>
              <span className="product-main product-main--large">
                {data.modelName}
                {data.variantDisplay ? ` ${data.variantDisplay}` : ""}
              </span>
            </td>
          </tr>
          <tr>
            <td className="pack-cell" colSpan={2}>
              <div className="pack-line">
                <strong>{data.packsPerCarton}</strong> Bottles/case
              </div>
              {volumeLabel && (
                <div className="pack-line">
                  <strong>{volumeLabel}</strong>
                </div>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Deliver to ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td className="field-label-cell">DELIVER TO</td>
            <td className="field-value-cell deliver-to-large" colSpan={2}>
              <strong>{data.customerName}</strong>
              {data.customerIsland && (
                <><br /><strong>{data.customerIsland}</strong></>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Phone ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td className="field-label-cell">PHONE</td>
            <td className="phone-value-cell">
              <strong>{data.customerPhone ?? "—"}</strong>
            </td>
            <td className="dhivehi-cell">
              <span className="dhivehi">ދިވެހިރާއްޖެ</span>
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Boat ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td rowSpan={3} className="field-label-cell boat-label">BOAT</td>
            <td className="boat-key">NAME</td>
            <td className="boat-val">{boatName || "—"}</td>
          </tr>
          <tr>
            <td className="boat-key">JETTY</td>
            <td className="boat-val">{boatJetty || "—"}</td>
          </tr>
          <tr>
            <td className="boat-key">DATE &amp; No</td>
            <td className="boat-val">
              {boatDate}
              {boatNumber ? ` - ${boatNumber}` : ""}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── Thank you ── */}
      <div className="thankyou-block">
        <span className="quote-open">&ldquo;</span>
        <p className="thankyou-text">
          <strong>Thank you</strong> for your order.<br />
          We look forward to serving you soon<br />
          with your next re-stock
          <span className="quote-close">&rdquo;</span>
        </p>
      </div>

      <hr className="divider" />

      {/* ── Social ── */}
      <div className="social-row">
        <SocialIcons />
        <span className="social-handle">@saynomore.mv</span>
      </div>

      <hr className="divider" />

      {/* ── Follow us ── */}
      <div className="follow-bar">
        FOLLOW US FOR MORE PRODUCTS AND OFFERS
      </div>

      {/* ── Footer ── */}
      <div className="footer-row">
        <div className="undeliverable-block">
          <p className="undeliverable-text">IF UNDELIVERABLE PLEASE CALL</p>
          <p className="undeliverable-number">7430309</p>
          <p className="dhivehi small">ބަލިވެ ހުރެ ނުގެންދެވިއްޖެ ނަމަ ގުޅާ</p>
        </div>
        <div className="qr-placeholder">
          <QrPlaceholder />
        </div>
      </div>

      {/* ── Barcode ── */}
      <div className="barcode-row">
        <BarcodePlaceholder />
        <span className="barcode-nums">7430&nbsp;&nbsp;&nbsp;&nbsp;3090</span>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SaynomoreLogo() {
  return (
    <div className="snm-logo">
      <svg width="140" height="38" viewBox="0 0 140 38" fill="none" xmlns="http://www.w3.org/2000/svg">
        <text x="70" y="30" textAnchor="middle" fontFamily="Georgia, serif" fontSize="28" fontWeight="bold" fill="currentColor" letterSpacing="-1">
          say<tspan>o</tspan>more
        </text>
        <circle cx="83" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function BottleIcon() {
  return (
    <svg width="42" height="60" viewBox="0 0 42 60" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      {/* cap */}
      <rect x="14" y="0" width="14" height="8" rx="3" />
      {/* neck */}
      <rect x="17" y="8" width="8" height="8" />
      {/* shoulder curve */}
      <path d="M10 20 Q8 16 17 16 L25 16 Q34 16 32 20 Z" />
      {/* body */}
      <rect x="8" y="20" width="26" height="34" rx="5" />
      {/* label stripe */}
      <rect x="10" y="28" width="22" height="14" rx="2" fill="white" opacity="0.25" />
    </svg>
  );
}

function SocialIcons() {
  return (
    <span className="social-icons">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </span>
  );
}

function QrPlaceholder() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="6" y="6" width="14" height="14" />
      <rect x="38" y="0" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="44" y="6" width="14" height="14" />
      <rect x="0" y="38" width="26" height="26" rx="2" fill="none" stroke="currentColor" strokeWidth="3" />
      <rect x="6" y="44" width="14" height="14" />
      <rect x="38" y="38" width="6" height="6" />
      <rect x="48" y="38" width="6" height="6" />
      <rect x="58" y="38" width="6" height="6" />
      <rect x="38" y="48" width="6" height="6" />
      <rect x="52" y="48" width="12" height="6" />
      <rect x="38" y="58" width="6" height="6" />
      <rect x="48" y="58" width="6" height="6" />
      <rect x="58" y="58" width="6" height="6" />
    </svg>
  );
}

function BarcodePlaceholder() {
  const bars = [3,1,2,1,3,1,1,2,1,3,2,1,1,3,1,2,1,1,3,2,1,1,2,3,1,1,3,1,2,1];
  let x = 0;
  return (
    <svg width="120" height="40" viewBox="0 0 120 40" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      {bars.map((w, i) => {
        const bar = i % 2 === 0 ? (
          <rect key={i} x={x} y="0" width={w * 3} height="40" />
        ) : null;
        x += w * 3;
        return bar;
      })}
    </svg>
  );
}
