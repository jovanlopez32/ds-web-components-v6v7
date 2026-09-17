import { tv } from "tailwind-variants";

/**
 * Positioned `absolute`, not `fixed`: unlike starwind's other overlays, this
 * drawer is meant to be portaled into a caller-chosen container (via the
 * `container` prop) and clipped to it, rather than covering the viewport.
 *
 * No enter/exit animation on purpose: this is a static preview tool, not a
 * marketing surface, and the slide/fade transition was the source of a
 * visible flash on open (the `@starting-style`-driven transform racing the
 * `<dialog>` element's own native show/hide). Instant is faster to reason
 * about, and there is nothing here worth animating.
 */
export const drawerBackdrop = tv({
  base: "absolute inset-0 z-40 hidden bg-transparent data-[state=open]:block",
});

export const drawerContent = tv({
  base: [
    // `border-0` cancels <dialog>'s UA-stylesheet default `border: solid`,
    // which otherwise survives on every side the variant below doesn't
    // explicitly touch. Separation from the frame behind it comes from the
    // background-color jump (bg-foreground vs. the frame's bg-background),
    // not a drawn line.
    "absolute z-50 flex flex-col border-0 bg-foreground text-background",
  ],
  variants: {
    side: {
      right: [
        // `h-full` (not just `inset-y-0`) because <dialog>'s UA stylesheet sets
        // an explicit `height: fit-content`, which pre-empts the usual
        // top+bottom-imply-height behavior of an absolutely positioned box.
        // `left-auto` cancels that same stylesheet's default `left: 0`, which
        // would otherwise fight `right-0` and pin this to the wrong edge.
        "inset-y-0 right-0 left-auto h-full w-full max-w-[420px]",
      ],
      left: ["inset-y-0 left-0 right-auto h-full w-full max-w-[420px]"],
      bottom: ["inset-x-0 bottom-0 w-full max-h-[80%]"],
      top: ["inset-x-0 top-0 w-full max-h-[80%]"],
    },
  },
  defaultVariants: {
    side: "right",
  },
});

export const drawerTitle = tv({
  base: "font-heading text-sm font-semibold",
});

export const drawerClose = tv({
  base: "appearance-none inline-flex size-7 shrink-0 items-center justify-center text-background/70 outline-none transition-colors hover:bg-background/15 hover:text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-background",
});
