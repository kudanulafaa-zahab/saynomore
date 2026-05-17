import React from "react";
import type { LabelData } from "@/lib/queries/labels";
import { SnmLogo, DetergentIcon, SnmBarcode, SnmQrCode, SocialIcons } from "./snm-assets";

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
        <div className="snm-logo">
          <SnmLogo width={140} height={36} />
        </div>
        <p className="tagline">discover · shop · enjoy</p>
      </div>

      {/* ── Product block ── */}
      <table className="label-table">
        <tbody>
          <tr>
            <td rowSpan={2} className="icon-cell">
              <DetergentIcon size={36} />
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
          <SnmQrCode size={64} />
        </div>
      </div>

      {/* ── Barcode ── */}
      <div className="barcode-row">
        <SnmBarcode width={160} />
      </div>
    </div>
  );
}
