"use client";

import { API_ROUTES, type ImagingSeries } from "@health-mcp/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

interface Props {
  patientId: string;
  studyId: string;
  series: ImagingSeries[];
}

const middle = (series: ImagingSeries | undefined) => Math.floor((series?.imageCount ?? 0) / 2);

/**
 * Scrolls through the slices of one series at a time: slider, buttons, arrow
 * keys or the mouse wheel. Starts at the middle slice, like most viewers.
 */
export function ImageViewer({ patientId, studyId, series }: Props) {
  const viewable = series.filter((s) => s.imageCount > 0);
  const [seriesId, setSeriesId] = useState(viewable[0]?.id);
  const current = viewable.find((s) => s.id === seriesId);
  const [position, setPosition] = useState(middle(current));
  const frameRef = useRef<HTMLDivElement>(null);
  const count = current?.imageCount ?? 0;

  const src = (index: number) =>
    current ? API_ROUTES.imagingImage(patientId, studyId, current.id, index) : "";
  const go = (index: number) => setPosition(Math.min(Math.max(index, 0), count - 1));

  // Load the neighbouring slices ahead, so scrolling does not wait for them.
  useEffect(() => {
    if (!current) return;
    for (const index of [position + 1, position - 1, position + 2])
      if (index >= 0 && index < count) new Image().src = src(index);
  });

  // React's wheel listener is passive, so it cannot stop the page from scrolling.
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setPosition((p) => Math.min(Math.max(p + Math.sign(event.deltaY), 0), count - 1));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [count]);

  if (!current) return <p className="muted card">This study has no images that can be shown.</p>;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = {
      ArrowUp: position - 1,
      ArrowLeft: position - 1,
      ArrowDown: position + 1,
      ArrowRight: position + 1,
      Home: 0,
      End: count - 1,
    };
    const target = moves[event.key];
    if (target === undefined) return;
    event.preventDefault();
    go(target);
  }

  const label = current.description ?? `Series ${current.seriesNumber ?? ""}`.trim();
  return (
    <div className="viewer">
      {viewable.length > 1 && (
        <div className="viewer-series" role="tablist" aria-label="Series">
          {viewable.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === current.id}
              className={s.id === current.id ? "button" : "button secondary"}
              onClick={() => {
                setSeriesId(s.id);
                setPosition(middle(s));
              }}
            >
              {s.description ?? `Series ${s.seriesNumber ?? ""}`} ({s.imageCount})
            </button>
          ))}
        </div>
      )}

      <div
        ref={frameRef}
        className="viewer-frame"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label="Image viewer. Use the arrow keys or the mouse wheel to change slices."
      >
        <img src={src(position)} alt={`${label}, slice ${position + 1} of ${count}`} />
      </div>

      <div className="viewer-controls">
        <button
          type="button"
          className="button secondary"
          onClick={() => go(position - 1)}
          disabled={position === 0}
        >
          Previous
        </button>
        <input
          type="range"
          min={1}
          max={count}
          value={position + 1}
          onChange={(event) => go(Number(event.target.value) - 1)}
          aria-label="Slice"
          disabled={count === 1}
        />
        <button
          type="button"
          className="button secondary"
          onClick={() => go(position + 1)}
          disabled={position === count - 1}
        >
          Next
        </button>
        <span className="muted" aria-live="polite">
          Slice {position + 1} of {count}
        </span>
      </div>
    </div>
  );
}
