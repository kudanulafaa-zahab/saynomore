import React from "react";
import type { LabelData } from "@/lib/queries/labels";
import { SnmLogo, DiaperIcon, SnmBarcode, SnmQrCode, SocialIcons, DhivehiNumberText, RecycleIcon } from "./snm-assets";

interface Props {
  data: LabelData;
  boatName: string;
  boatJetty: string;
  boatDate: string;
  boatTime: string;
  boatNumber: string;
}

export function DiaperTemplate({ data, boatName, boatJetty, boatDate, boatTime, boatNumber }: Props) {
  return (
    <div className="label-root">

      {/* ── HEADER: logo centred ── */}
      <div className="label-header">
        <SnmLogo width={130} height={34} />
      </div>

      {/* ── PRODUCT BLOCK ── */}
      <table className="label-table">
        <tbody>
          <tr>
            {/* Icon column */}
            <td rowSpan={2} className="icon-cell">
              <DiaperIcon size={38} />
            </td>
            {/* Product name + variant */}
            <td className="product-name-cell" colSpan={2}>
              <span className="product-main">{data.modelName}</span>
              {data.variantDisplay && (
                <span className="product-sub">{data.variantDisplay}</span>
              )}
            </td>
          </tr>
          <tr>
            {/* Pack info */}
            <td className="pack-cell">
              <div className="pack-line">
                <strong>{data.pcsPerPack}</strong> pcs/pack
              </div>
              <div className="pack-line">
                <strong>{data.packsPerCarton}</strong> packs/case
              </div>
            </td>
            {/* Size badge if present */}
            {data.size ? (
              <td className="size-cell">
                <span className="size-label">SIZE</span>
                <span className="size-value">{data.size}</span>
              </td>
            ) : (
              <td className="pack-cell">
                {/* Recycle icon in corner when no size */}
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <RecycleIcon size={14} />
                </div>
              </td>
            )}
          </tr>
        </tbody>
      </table>

      {/* ── DELIVER TO — 4-line address block ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td className="field-label-cell">DELIVER TO</td>
            <td className="field-value-cell">
              <strong style={{ display: "block", fontSize: "11pt", lineHeight: 1.3 }}>{data.deliveryName}</strong>
              {data.deliveryAddressLine1 && (
                <span style={{ display: "block", fontSize: "9pt", lineHeight: 1.3 }}>{data.deliveryAddressLine1}</span>
              )}
              {data.deliveryAddressLine2 && (
                <span style={{ display: "block", fontSize: "9pt", lineHeight: 1.3 }}>{data.deliveryAddressLine2}</span>
              )}
              {data.deliveryIsland && (
                <strong style={{ display: "block", fontSize: "10pt", lineHeight: 1.3 }}>{data.deliveryIsland}</strong>
              )}
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── PHONE ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td className="field-label-cell">PHONE</td>
            <td className="phone-value-cell">
              <strong>{data.customerPhone ?? "—"}</strong>
            </td>
            <td className="dhivehi-cell">
              <DhivehiNumberText width={56} />
            </td>
          </tr>
        </tbody>
      </table>

      {/* ── BOAT ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td rowSpan={4} className="field-label-cell boat-label">BOAT</td>
            <td className="boat-key">NAME</td>
            <td className="boat-val">{boatName || "—"}</td>
          </tr>
          <tr>
            <td className="boat-key">JETTY</td>
            <td className="boat-val">{boatJetty || "—"}</td>
          </tr>
          <tr>
            <td className="boat-key">DATE</td>
            <td className="boat-val">{boatDate || "—"}{boatTime ? ` · ${boatTime}` : ""}</td>
          </tr>
          <tr>
            <td className="boat-key">No.</td>
            <td className="boat-val">{boatNumber || "—"}</td>
          </tr>
        </tbody>
      </table>

      {/* ── THANK YOU ── */}
      <div className="thankyou-block">
        <span className="quote-open">&ldquo;</span>
        <p className="thankyou-text">
          <strong>Thank you</strong> for trusting us with your baby&rsquo;s comfort.<br />
          We look forward to serving you soon with your next re-stock
          <span className="quote-close">&rdquo;</span>
        </p>
      </div>

      <hr className="divider" />

      {/* ── SOCIAL ROW ── */}
      <div className="social-row">
        <SocialIcons width={100} />
        <span className="social-handle">@saynomore.mv</span>
      </div>

      <hr className="divider" />

      {/* ── FOLLOW BAR ── */}
      <div className="follow-bar">
        FOLLOW US FOR MORE PRODUCTS AND OFFERS
      </div>

      {/* ── FOOTER: undeliverable + QR ── */}
      <div className="footer-row">
        <div className="undeliverable-block">
          <p className="undeliverable-text">IF UNDELIVERABLE PLEASE CALL</p>
          <p className="undeliverable-number">7430309</p>
          <p className="dhivehi small">ބަލިވެ ހުރެ ނުގެންދެވިއްޖެ ނަމަ ގުޅާ</p>
        </div>
        <div className="qr-placeholder">
          <SnmQrCode size={60} />
        </div>
      </div>

      {/* ── BARCODE ── */}
      <div className="barcode-row">
        <SnmBarcode width={150} />
      </div>

    </div>
  );
}
