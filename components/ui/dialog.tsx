"use client"

import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        // Catch touch/scroll so the layer beneath the sheet stays frozen (native iOS)
        "touch-none overscroll-contain",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  selfManaged = false,
  ...props
}: DialogPrimitive.Popup.Props & {
  showCloseButton?: boolean
  /**
   * Opt out of the built-in padded scroll body. Use when the call site renders
   * its own header / scrolling body / footer layout (e.g. a custom card with
   * its own px padding). The popup still clamps height + clears the home bar.
   */
  selfManaged?: boolean
}) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          // Mobile: bottom sheet — slides up from bottom, clears home bar
          // Desktop (sm+): centred modal capped at viewport with safe insets
          "fixed z-50 w-full bg-popover text-sm text-popover-foreground outline-none",
          // Flex column so header/footer stay fixed and the body flexes to fill
          "flex flex-col",
          // Mobile layout: bottom sheet
          "bottom-0 left-0 right-0 rounded-t-[28px]",
          "max-h-[calc(100dvh-env(safe-area-inset-top,44px)-8px)]",
          // Desktop layout: centred card
          "sm:bottom-auto sm:left-1/2 sm:right-auto sm:top-1/2",
          "sm:-translate-x-1/2 sm:-translate-y-1/2",
          "sm:rounded-xl sm:max-w-sm sm:max-h-[calc(100dvh-env(safe-area-inset-top,44px)-32px)]",
          "ring-1 ring-foreground/10 duration-150 overflow-hidden",
          "data-open:animate-in data-open:fade-in-0",
          "sm:data-open:zoom-in-95",
          "max-[639px]:data-open:slide-in-from-bottom-4",
          "data-closed:animate-out data-closed:fade-out-0",
          "sm:data-closed:zoom-out-95",
          "max-[639px]:data-closed:slide-out-to-bottom-4",
          className
        )}
        {...props}
      >
        {/* Drag handle — mobile only */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-9 h-[3px] rounded-full bg-foreground/20" />
        </div>
        {selfManaged ? (
          children
        ) : (
          /* Scrollable padded body. Horizontal padding lives here so no child
             bleeds to the screen edge; bottom padding clears the iOS home bar. */
          <div className="flex flex-col gap-4 overflow-y-auto overscroll-contain px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4">
            {children}
          </div>
        )}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button
                variant="ghost"
                className="absolute top-2 right-2"
                size="icon-sm"
              />
            }
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // Sticks to the bottom of the scroll body; negative insets bleed the
        // bar to the padded parent's edges. mt-auto pins it down when content
        // is short; sticky keeps it visible while the body scrolls.
        "sticky bottom-0 mt-auto -mx-4 -mb-[max(1rem,env(safe-area-inset-bottom))] sm:-mb-4 flex flex-col-reverse gap-2 border-t bg-muted/50 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:pb-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline" />}>
          Close
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
