import { useRef, useCallback, useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";
import { TechniqueNodeCard } from "./TechniqueNodeCard";
import { EdgePath, ArrowheadDef } from "./EdgePath";
import { NODE_WIDTH, NODE_HEIGHT } from "@/lib/techniqueGraph";
import type { GraphNode, GraphEdge } from "@/types/technique";

const MIN_SCALE = 0.3;
const MAX_SCALE = 2.5;

interface SkillTreeGraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  bounds: { width: number; height: number };
  onNodeTap: (node: GraphNode) => void;
}

interface Transform {
  translateX: number;
  translateY: number;
  scale: number;
}

export function SkillTreeGraph({ nodes, edges, bounds, onNodeTap }: SkillTreeGraphProps) {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<Transform>({ translateX: 0, translateY: 0, scale: 1 });
  const layerRef = useRef<HTMLDivElement>(null);
  const [, forceRender] = useState(0);

  // Gesture state refs (no re-renders during gestures)
  const gestureRef = useRef({
    isPanning: false,
    startX: 0,
    startY: 0,
    startTranslateX: 0,
    startTranslateY: 0,
    initialPinchDist: 0,
    initialScale: 1,
  });

  const applyTransform = useCallback(() => {
    if (!layerRef.current) return;
    const { translateX, translateY, scale } = transformRef.current;
    layerRef.current.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale}) translateZ(0)`;
  }, []);

  // Fit to view on mount or when bounds change
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const padding = 40;
    const scaleX = (rect.width - padding * 2) / bounds.width;
    const scaleY = (rect.height - padding * 2) / bounds.height;
    const scale = Math.min(Math.max(Math.min(scaleX, scaleY), MIN_SCALE), MAX_SCALE);

    transformRef.current = {
      scale,
      translateX: (rect.width - bounds.width * scale) / 2,
      translateY: (rect.height - bounds.height * scale) / 2,
    };
    applyTransform();
    forceRender((n) => n + 1);
  }, [bounds, applyTransform]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Touch handlers
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      gestureRef.current.isPanning = true;
      gestureRef.current.startX = touch.clientX;
      gestureRef.current.startY = touch.clientY;
      gestureRef.current.startTranslateX = transformRef.current.translateX;
      gestureRef.current.startTranslateY = transformRef.current.translateY;
    } else if (e.touches.length === 2) {
      gestureRef.current.isPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      gestureRef.current.initialPinchDist = Math.hypot(dx, dy);
      gestureRef.current.initialScale = transformRef.current.scale;
    }
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 1 && gestureRef.current.isPanning) {
        const touch = e.touches[0];
        const dx = touch.clientX - gestureRef.current.startX;
        const dy = touch.clientY - gestureRef.current.startY;
        transformRef.current.translateX = gestureRef.current.startTranslateX + dx;
        transformRef.current.translateY = gestureRef.current.startTranslateY + dy;
        requestAnimationFrame(applyTransform);
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const scaleRatio = dist / gestureRef.current.initialPinchDist;
        const newScale = Math.min(
          MAX_SCALE,
          Math.max(MIN_SCALE, gestureRef.current.initialScale * scaleRatio)
        );
        transformRef.current.scale = newScale;
        requestAnimationFrame(applyTransform);
      }
    },
    [applyTransform]
  );

  const handleTouchEnd = useCallback(() => {
    gestureRef.current.isPanning = false;
  }, []);

  // Mouse/pointer handlers for desktop
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.pointerType === "touch") return; // handled by touch events
    gestureRef.current.isPanning = true;
    gestureRef.current.startX = e.clientX;
    gestureRef.current.startY = e.clientY;
    gestureRef.current.startTranslateX = transformRef.current.translateX;
    gestureRef.current.startTranslateY = transformRef.current.translateY;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!gestureRef.current.isPanning || e.pointerType === "touch") return;
      const dx = e.clientX - gestureRef.current.startX;
      const dy = e.clientY - gestureRef.current.startY;
      transformRef.current.translateX = gestureRef.current.startTranslateX + dx;
      transformRef.current.translateY = gestureRef.current.startTranslateY + dy;
      requestAnimationFrame(applyTransform);
    },
    [applyTransform]
  );

  const handlePointerUp = useCallback(() => {
    gestureRef.current.isPanning = false;
  }, []);

  // Mouse wheel zoom for desktop
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, transformRef.current.scale * delta));

      // Zoom toward cursor position
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const scaleDiff = newScale - transformRef.current.scale;
        transformRef.current.translateX -= mouseX * (scaleDiff / transformRef.current.scale);
        transformRef.current.translateY -= mouseY * (scaleDiff / transformRef.current.scale);
      }

      transformRef.current.scale = newScale;
      requestAnimationFrame(applyTransform);
    },
    [applyTransform]
  );

  if (nodes.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        <p>Log a technique to start building your skill tree</p>
      </div>
    );
  }

  return (
    <div className="relative flex-1 overflow-hidden rounded-xs border border-border/50 bg-background/50">
      {/* Fit to view button */}
      <button
        onClick={fitToView}
        className="absolute top-3 right-3 z-10 h-8 w-8 flex items-center justify-center rounded-xs bg-background/90 border border-border/50 text-muted-foreground text-xs active:scale-90 transition-transform"
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
        aria-label="Fit to view"
      >
        ⊞
      </button>

      {/* Graph viewport */}
      <div
        ref={containerRef}
        className="w-full h-full touch-none"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
      >
        {/* Transform layer */}
        <div
          ref={layerRef}
          className={prefersReducedMotion ? "" : "transition-none"}
          style={{
            willChange: "transform",
            transformOrigin: "0 0",
          }}
        >
          <svg
            width={bounds.width}
            height={bounds.height}
            viewBox={`0 0 ${bounds.width} ${bounds.height}`}
            className="overflow-visible"
          >
            <ArrowheadDef />
            {edges.map((edge, i) => (
              <EdgePath key={`${edge.source}-${edge.target}-${i}`} edge={edge} />
            ))}
            {nodes.map((node) => (
              <foreignObject
                key={node.id}
                x={node.x - NODE_WIDTH / 2}
                y={node.y - NODE_HEIGHT / 2}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                className="overflow-visible"
              >
                <TechniqueNodeCard node={node} onTap={onNodeTap} />
              </foreignObject>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}
