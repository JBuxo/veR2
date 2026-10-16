import { cn } from "@/lib/utils";

/**
 * Where veR2 keeps things in a bucket, and who talks to what. Writes go through the SDK;
 * readers hit the live object directly. Two layouts so labels stay legible on phones.
 * Colors come from theme tokens, so it follows light/dark.
 */
export function ArchitectureDiagram({ className }: { className?: string }) {
  return (
    <figure className={cn("not-prose my-6 rounded-xl border bg-muted/30 p-4 md:p-6", className)}>
      <WideLayout className="hidden w-full md:block" />
      <TallLayout className="mx-auto block w-full max-w-sm md:hidden" />
      <figcaption className="mt-4 text-center text-sm text-muted-foreground">
        Writes go through veR2. Reads go straight to R2, exactly as before.
      </figcaption>
    </figure>
  );
}

const DESC =
  "Your app writes through the veR2 SDK, which stores a manifest, immutable version objects and the live object in the R2 bucket. Readers such as CDNs, public URLs and presigned GETs read the live object directly.";

/** Arrowheads. Ids are per layout: markers inside a display:none SVG don't render elsewhere. */
function Markers({ prefix }: { prefix: string }) {
  return (
    <defs>
      <marker id={`${prefix}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" className="fill-foreground" />
      </marker>
      <marker id={`${prefix}-arrow-muted`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L10 5 L0 10 z" className="fill-muted-foreground" />
      </marker>
    </defs>
  );
}

interface BoxProps {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  sub?: string;
  mono?: boolean;
  /** Visual weight: the live object is the one readers see. */
  tone?: "default" | "live" | "stack";
}

function Box({ x, y, w, h, title, sub, mono, tone = "default" }: BoxProps) {
  const titleY = sub ? y + h / 2 - 4 : y + h / 2 + 5;
  return (
    <g>
      {tone === "stack" && (
        <>
          <rect x={x + 8} y={y - 8} width={w} height={h} rx={10} className="fill-muted stroke-border" strokeWidth={1.5} />
          <rect x={x + 4} y={y - 4} width={w} height={h} rx={10} className="fill-muted stroke-border" strokeWidth={1.5} />
        </>
      )}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        className={tone === "live" ? "fill-background stroke-foreground" : "fill-background stroke-border"}
        strokeWidth={tone === "live" ? 2 : 1.5}
      />
      <text x={x + 16} y={titleY} fontSize={14} fontWeight={600} className={cn("fill-foreground", mono && "font-mono")}>
        {title}
      </text>
      {sub && (
        <text x={x + 16} y={y + h / 2 + 16} fontSize={12} className="fill-muted-foreground">
          {sub}
        </text>
      )}
    </g>
  );
}

function Label({ x, y, children, anchor = "middle" }: { x: number; y: number; children: string; anchor?: "start" | "middle" | "end" }) {
  return (
    <text x={x} y={y} fontSize={12} textAnchor={anchor} className="fill-muted-foreground">
      {children}
    </text>
  );
}

function WideLayout({ className }: { className?: string }) {
  const p = "arch-wide";
  return (
    <svg viewBox="0 0 760 330" className={className} role="img" aria-labelledby={`${p}-title ${p}-desc`}>
      <title id={`${p}-title`}>How veR2 stores versions in an R2 bucket</title>
      <desc id={`${p}-desc`}>{DESC}</desc>
      <Markers prefix={p} />

      <Box x={10} y={50} w={140} h={56} title="Your app" />
      <path d="M150 78 H196" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />
      <Label x={174} y={66}>writes</Label>
      <Box x={200} y={50} w={140} h={56} title="veR2 SDK" sub="put · delete · restore" />

      {/* The bucket */}
      <rect x={380} y={10} width={370} height={300} rx={14} className="fill-muted/40 stroke-border" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={398} y={36} fontSize={13} fontWeight={600} className="fill-foreground">
        R2 bucket
      </text>

      <Box x={400} y={50} w={330} h={56} mono title=".ver2/m/uploads/a.png" sub="Manifest: history + journal of the write in flight" />
      <Box x={400} y={140} w={322} h={56} mono tone="stack" title=".ver2/o/…/<versionId>" sub="Immutable version bytes, written once" />
      <Box x={400} y={236} w={330} h={56} mono tone="live" title="uploads/a.png" sub="Live object: same key as always" />

      {/* SDK fans out to manifest, versions and live */}
      <path d="M340 78 H396" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />
      <path d="M340 92 C370 92 366 168 396 168" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />
      <path d="M340 100 C364 100 362 252 396 252" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />

      {/* Readers bypass veR2 entirely */}
      <Box x={10} y={236} w={250} h={56} title="Readers" sub="CDNs · public URLs · presigned GETs" />
      <path
        d="M260 278 H396"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        strokeDasharray="5 4"
        markerEnd={`url(#${p}-arrow-muted)`}
        fill="none"
      />
      <Label x={322} y={270}>reads, unchanged</Label>
    </svg>
  );
}

function TallLayout({ className }: { className?: string }) {
  const p = "arch-tall";
  return (
    <svg viewBox="0 0 360 520" className={className} role="img" aria-labelledby={`${p}-title ${p}-desc`}>
      <title id={`${p}-title`}>How veR2 stores versions in an R2 bucket</title>
      <desc id={`${p}-desc`}>{DESC}</desc>
      <Markers prefix={p} />

      <Box x={10} y={10} w={140} h={50} title="Your app" />
      <path d="M150 35 H206" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />
      <Box x={210} y={10} w={140} h={50} title="veR2 SDK" />
      <path d="M280 60 V106" className="stroke-foreground" strokeWidth={1.5} markerEnd={`url(#${p}-arrow)`} fill="none" />
      <Label x={290} y={88} anchor="start">writes</Label>

      <rect x={10} y={110} width={340} height={300} rx={14} className="fill-muted/40 stroke-border" strokeWidth={1.5} strokeDasharray="6 5" />
      <text x={28} y={136} fontSize={13} fontWeight={600} className="fill-foreground">
        R2 bucket
      </text>

      <Box x={28} y={150} w={304} h={60} mono title=".ver2/m/uploads/a.png" sub="Manifest: history + write journal" />
      <Box x={28} y={240} w={296} h={60} mono tone="stack" title=".ver2/o/…/<versionId>" sub="Immutable version bytes" />
      <Box x={28} y={330} w={304} h={60} mono tone="live" title="uploads/a.png" sub="Live object: same key as always" />

      <Box x={30} y={454} w={300} h={56} title="Readers" sub="CDNs · public URLs · presigned GETs" />
      <path
        d="M180 454 V394"
        className="stroke-muted-foreground"
        strokeWidth={1.5}
        strokeDasharray="5 4"
        markerEnd={`url(#${p}-arrow-muted)`}
        fill="none"
      />
      <Label x={190} y={430} anchor="start">reads, unchanged</Label>
    </svg>
  );
}
