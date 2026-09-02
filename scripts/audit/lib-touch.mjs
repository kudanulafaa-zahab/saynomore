// The ONE definition of "is this control big enough", and of what is exempt.
//
// It lives here because there are now TWO audits that need it: touch-targets
// measures the 21 screens as they load, and touch-targets-sheets opens the
// sheets and dialogs those screens put in front of Ali. Two copies of this
// function would be two answers to the same question — the exact bug class
// audit:onedef exists to forbid — and the exemptions are the part that would
// drift first, because they are the part with reasoning behind them.
//
// It is evaluated INSIDE the browser (page.evaluate), so it must be a plain
// function with no imports and no closure over anything out here.

const AUDIT_IMPL = (min, root) => {
  const SEL = 'button, a[href], select, textarea, input:not([type="hidden"]), [role="button"], [role="tab"], [role="switch"], [role="option"]';
  const out = [];
  for (const el of (root ?? document).querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkVisibilityCSS: true })) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    if (el.disabled || el.getAttribute("aria-disabled") === "true") continue;

    // A LINK INSIDE A SENTENCE IS EXEMPT, in both WCAG and the HIG: padding it
    // to 44px would break the line it lives in. The test is the box, not the
    // tag — an inline-displayed anchor is running text.
    if (el.tagName === "A" && cs.display.startsWith("inline") && !cs.display.includes("block")) continue;

    // A SCRUB RAIL IS ONE CONTROL, NOT N TARGETS.
    //
    // Customers' A–Z index is 27 letters at 22x19, and it was 27 of the 101
    // findings — a quarter of the whole debt, from one control. Enlarging the
    // letters to 44px each would need 1,188px of height on a phone that has
    // about 700, so the only way to "fix" it is to delete the alphabet, which
    // is the feature.
    //
    // It is exempt because it is not 27 discrete targets. It is a single
    // continuous gesture surface: you press it and slide, and a HUD follows
    // your thumb — the rail is ~500px tall and 22px wide, far past 44 in the
    // axis that carries the gesture. A tap on an empty letter snaps to the
    // nearest section, so there are no dead targets inside it either. This is
    // Apple's own Contacts geometry, and WCAG 2.2 SC 2.5.8 makes the same
    // allowance for a target whose presentation is essential.
    //
    // Keyed on an explicit data-scrub-rail marker rather than a guess about
    // size or position, so nothing else is quietly swept in with it: a second
    // rail would have to opt in, in its own markup, deliberately.
    if (el.closest("[data-scrub-rail]")) continue;

    // A control whose PARENT is the real tap target is not itself a target —
    // an icon inside a row that is one big link, for instance. Judging both
    // would report the row's own chevron as a defect.
    const outer = el.parentElement?.closest(SEL);
    if (outer) {
      const pr = outer.getBoundingClientRect();
      if (pr.height >= min && pr.width >= min) continue;
    }

    // A LABEL IS A TAP TARGET. Clicking a <label> activates the control it
    // wraps — that is HTML, not a convention — so a 20px checkbox inside a
    // 44px label is a 44px target and reporting it is a false positive.
    // The label still has to BE 44px: wrapping a small box in a small label
    // buys nothing, and this is measured rather than assumed.
    const lab = el.closest("label");
    if (lab && lab !== el) {
      const lr = lab.getBoundingClientRect();
      if (lr.height >= min && lr.width >= min) continue;
    }

    // The HIT AREA, not the ink. A 24px icon centred in 44px of padding is a
    // 44px target, and this is the box the browser actually routes taps to.
    if (r.width >= min && r.height >= min) continue;

    const cls = (el.className || "").toString().split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    out.push({
      what: `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`,
      label: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 24).replace(/\n/g, " "),
      size: `${Math.round(r.width)}x${Math.round(r.height)}`,
    });
  }
  return out;
};

/** Every control under `min` in the whole page. */
export const AUDIT = AUDIT_IMPL;

/** The same measurement, but only inside a given element — used for sheets and
 *  dialogs, where the page behind them is not what is being judged.
 *
 *  Takes ONE argument, because that is all page.evaluate passes. An
 *  ElementHandle nested in that array arrives here as a real DOM node, which
 *  is how the root gets across the boundary at all. */
export const AUDIT_WITHIN = ([root, min]) => AUDIT_IMPL(min, root);

