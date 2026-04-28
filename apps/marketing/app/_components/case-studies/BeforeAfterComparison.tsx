"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import type { CaseStudyImage } from "../../../content/caseStudies";

type ViewMode = "before" | "after";

type BeforeAfterComparisonProps = {
  beforeImages: CaseStudyImage[];
  afterImages: CaseStudyImage[];
};

function renderImageStack(label: string, images: CaseStudyImage[]) {
  return (
    <article className="before-after__panel">
      <p className="before-after__label">{label}</p>
      <div className="before-after__stack">
        {images.map((image) => (
          <div key={image.src} className="before-after__frame">
            <Image
              src={image.src}
              alt={image.alt}
              width={image.width}
              height={image.height}
              sizes="(max-width: 980px) 100vw, 46vw"
            />
          </div>
        ))}
      </div>
    </article>
  );
}

export default function BeforeAfterComparison({ beforeImages, afterImages }: BeforeAfterComparisonProps) {
  const [view, setView] = useState<ViewMode>("before");
  const touchStartX = useRef<number | null>(null);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartX.current == null) return;
    const endX = event.changedTouches[0]?.clientX ?? touchStartX.current;
    const delta = endX - touchStartX.current;
    touchStartX.current = null;

    if (Math.abs(delta) < 36) return;
    setView(delta < 0 ? "after" : "before");
  };

  const activeImages = view === "before" ? beforeImages : afterImages;

  return (
    <div className="before-after" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <div className="before-after__desktop">
        {renderImageStack("Before", beforeImages)}
        {renderImageStack("After", afterImages)}
      </div>

      <div className="before-after__mobile">
        <div className="before-after__toggle" role="tablist" aria-label="Before and after toggle">
          <button
            type="button"
            className={`before-after__toggle-btn${view === "before" ? " is-active" : ""}`}
            role="tab"
            aria-selected={view === "before"}
            onClick={() => setView("before")}
          >
            Before
          </button>
          <button
            type="button"
            className={`before-after__toggle-btn${view === "after" ? " is-active" : ""}`}
            role="tab"
            aria-selected={view === "after"}
            onClick={() => setView("after")}
          >
            After
          </button>
        </div>
        <div className="before-after__stack" role="tabpanel" aria-live="polite">
          {activeImages.map((image) => (
            <div key={`${view}-${image.src}`} className="before-after__frame">
              <Image
                src={image.src}
                alt={image.alt}
                width={image.width}
                height={image.height}
                sizes="100vw"
              />
            </div>
          ))}
        </div>
        <p className="before-after__hint">Swipe to compare</p>
      </div>
    </div>
  );
}
