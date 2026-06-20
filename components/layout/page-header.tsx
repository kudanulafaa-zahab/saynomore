"use client";

import { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Optional subtitle / count shown below the title */
  subtitle?: string;
  /** Primary CTA button — rendered top-right as a filled pill */
  action?: ReactNode;
  /** Secondary/filter controls — rendered below the title row on mobile */
  controls?: ReactNode;
}

/**
 * iOS-style large title page header.
 * Rendered at the top of every page's content area (below the topbar).
 *
 * Usage:
 *   <PageHeader title="Sales" subtitle="12 orders" action={<button>+ New</button>} />
 */
export function PageHeader({ title, subtitle, action, controls }: PageHeaderProps) {
  return (
    <div className="mb-4">
      {/* Title row */}
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="min-w-0">
          <h1 className="ios-page-title">
            {title}
          </h1>
          {subtitle && (
            <p className="text-[13px] mt-1" style={{ color: "var(--muted-foreground)" }}>
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="shrink-0 mt-0.5">{action}</div>
        )}
      </div>

      {/* Optional controls row (search bars, filters) */}
      {controls && (
        <div className="mt-3">{controls}</div>
      )}
    </div>
  );
}
