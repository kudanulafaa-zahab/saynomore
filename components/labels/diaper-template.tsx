import React from "react";
import type { LabelData } from "@/lib/queries/labels";

// Static barcode and QR are rendered as pure CSS/SVG placeholders matching the reference design.
// For real scanning, replace with an actual barcode library if needed later.

interface Props {
  data: LabelData;
  boatName: string;
  boatJetty: string;
  boatDate: string;
  boatNumber: string;
}

export function DiaperTemplate({ data, boatName, boatJetty, boatDate, boatNumber }: Props) {
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
              <BabyIcon />
            </td>
            <td className="product-name-cell" colSpan={2}>
              <span className="product-main">{data.modelName}</span>
              {data.variantDisplay && (
                <span className="product-sub">{data.variantDisplay}</span>
              )}
            </td>
          </tr>
          <tr>
            <td className="pack-cell">
              <div className="pack-line">
                <strong>{data.pcsPerPack}</strong> pcs/pack
              </div>
              <div className="pack-line">
                <strong>{data.packsPerCarton}</strong> packs/case
              </div>
            </td>
            {data.size && (
              <td className="size-cell">
                <span className="size-label">SIZE</span>
                <span className="size-value">{data.size}</span>
              </td>
            )}
          </tr>
        </tbody>
      </table>

      {/* ── Deliver to ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td className="field-label-cell">DELIVER TO</td>
            <td className="field-value-cell" colSpan={2}>
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
          <strong>Thank you</strong> for trusting us with your baby&rsquo;s comfort.<br />
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
        {/* circle above the o */}
        <circle cx="83" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    </div>
  );
}

function BabyIcon() {
  return (
    <svg width="48" height="56" viewBox="0 0 48 56" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      {/* head */}
      <circle cx="24" cy="10" r="8" />
      {/* body */}
      <ellipse cx="24" cy="30" rx="11" ry="13" />
      {/* left leg */}
      <ellipse cx="14" cy="46" rx="5" ry="7" transform="rotate(-15 14 46)" />
      {/* right leg */}
      <ellipse cx="34" cy="46" rx="5" ry="7" transform="rotate(15 34 46)" />
      {/* left arm */}
      <ellipse cx="8" cy="26" rx="4" ry="7" transform="rotate(-30 8 26)" />
      {/* right arm */}
      <ellipse cx="40" cy="26" rx="4" ry="7" transform="rotate(30 40 26)" />
    </svg>
  );
}

function SocialIcons() {
  return (
    <span className="social-icons">
      {/* Instagram */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
      </svg>
      {/* Facebook */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
      </svg>
      {/* WhatsApp */}
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    </span>
  );
}

function QrPlaceholder() {
  // Simple static QR-like grid placeholder
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
