import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400",
  { variants: {
    variant: {
      default: "bg-violet-500 text-white hover:bg-violet-400",
      secondary: "bg-white/10 text-white hover:bg-white/15",
      outline: "border border-white/15 bg-transparent text-white hover:bg-white/10",
      ghost: "text-white/75 hover:bg-white/10 hover:text-white",
      destructive: "bg-rose-500 text-white hover:bg-rose-400",
    },
    size: { default: "h-11 px-5", sm: "h-9 px-3", lg: "h-13 px-6 text-base", icon: "h-10 w-10" },
  }, defaultVariants: { variant: "default", size: "default" } }
);
function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<"button"> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />;
}
export { Button, buttonVariants };
