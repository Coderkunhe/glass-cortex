import { RiBrainLine } from "@remixicon/react";

export default function Logo() {
  return (
    <div className="flex items-center gap-gm-2 select-none">
      <RiBrainLine className="text-gm-xl text-brand" />
      <span className="text-gm-lg font-semibold text-text tracking-tight">
        GlassCortex
      </span>
    </div>
  );
}
