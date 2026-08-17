"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      // EVERY ERROR IN THE APP WAS LANDING UNDER THE DYNAMIC ISLAND.
      //
      // Ali, 2026-08-16, with a screenshot of the New Sale flow: *"I get this
      // error message on top which is obscured by the Dynamic Island in iOS.
      // All such error messages are always obscured."* He was right, and it was
      // every module, because it is one setting in one place.
      //
      // Sonner's own default puts a mobile toast 16px from the top of the
      // VIEWPORT — and the viewport starts behind the status bar, so on a
      // Dynamic Island iPhone (top inset ~59px) the toast is drawn about 40px
      // INSIDE the Island. Nothing is broken; the message is simply painted
      // under the hardware.
      //
      // The offset is now expressed in terms of the safe area rather than a
      // number, which is the same rule the top bar, the sheets and the pull-to-
      // refresh spinner already follow (`env(safe-area-inset-top, 0px)` — see
      // globals.css and components/layout/topbar.tsx). A device with no inset
      // falls back to 0 and the toast keeps its normal gap, so this costs
      // nothing on desktop.
      //
      // A toast that cannot be read is worse than no toast: it fires, it
      // animates, it times out, and the person is left with a form that
      // silently refused them.
      offset={{
        top: "calc(env(safe-area-inset-top, 0px) + 24px)",
        right: "24px",
        bottom: "24px",
        left: "24px",
      }}
      mobileOffset={{
        top: "calc(env(safe-area-inset-top, 0px) + 12px)",
        right: "12px",
        bottom: "16px",
        left: "12px",
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
