import Image from "next/image";
import { Baby, Droplets, Sparkles } from "lucide-react";

function CategoryGlyph({ categoryName }: { categoryName: string }) {
  const Icon = categoryName === "Diapers" ? Baby : categoryName.includes("Detergent") ? Droplets : Sparkles;
  return <Icon className="h-8 w-8" style={{ color: "var(--muted-foreground)", opacity: 0.5 }} />;
}

// Most SKUs launch with no photo yet — this placeholder needs to look like a
// deliberate brand tile, not a broken image, since it'll be the common case
// at first (see docs/STOREFRONT_PLAN.md).
export function ProductImage({
  src,
  alt,
  categoryName,
  sizes,
  className,
}: {
  src: string | null;
  alt: string;
  categoryName: string;
  sizes?: string;
  className?: string;
}) {
  if (src) {
    return (
      <div className={`relative overflow-hidden ${className ?? ""}`}>
        <Image
          src={src}
          alt={alt}
          fill
          sizes={sizes ?? "(max-width: 640px) 50vw, 240px"}
          className="object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-center ${className ?? ""}`}
      style={{
        background: "linear-gradient(160deg, var(--muted), var(--glass-1))",
      }}
    >
      <CategoryGlyph categoryName={categoryName} />
    </div>
  );
}
