import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { CourseNebulaSummary } from '../../types';
import {
  edgePanVelocity,
  fitScene,
  clampCamera,
  worldToScreen,
  zoomAtPoint,
  type NebulaCamera,
} from '../../lib/nebula/nebula-camera';
import {
  layoutNebulaScene,
  type LayoutCourseNebula,
  type NebulaScene,
  type Point,
  type Size,
} from '../../lib/nebula/nebula-layout';
import { AstronomyBackdrop } from '../backgrounds/AstronomyBackdrop';
import { NebulaViewportControls } from './NebulaViewportControls';

interface KnowledgeNebulaBackgroundProps {
  summaries: CourseNebulaSummary[];
  onCourseOpen: (courseId: string) => void;
  reducedMotion?: boolean;
}

interface SceneTexture {
  canvas: HTMLCanvasElement;
  worldWidth: number;
  worldHeight: number;
}

interface PointerState extends Point {
  type: string;
}

interface PinchState {
  distance: number;
  midpoint: Point;
  camera: NebulaCamera;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map(part => part + part).join('')
    : normalized, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function fillCloud(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  color: string,
  opacity: number,
  rotation: number,
): void {
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(1, Math.max(0.12, radiusY / radiusX));
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radiusX);
  gradient.addColorStop(0, rgba(color, opacity));
  gradient.addColorStop(0.38, rgba(color, opacity * 0.58));
  gradient.addColorStop(0.74, rgba(color, opacity * 0.16));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, radiusX, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function paintCourseNebula(
  context: CanvasRenderingContext2D,
  course: LayoutCourseNebula,
  map: (point: Point) => Point,
  scale: number,
): void {
  const random = seededRandom(course.seed ^ 0xa24baed4);
  const center = map(course);
  const radius = course.radius * scale;
  const energy = Math.min(1, 0.2 + Math.sqrt(course.knowledgeCount) / 15);

  context.globalCompositeOperation = 'screen';
  fillCloud(context, center.x, center.y, radius * 1.05, radius * 0.52, course.palette.gas, 0.23 + energy * 0.18, random() * Math.PI);
  fillCloud(context, center.x - radius * 0.2, center.y + radius * 0.02, radius * 0.72, radius * 0.27, course.palette.core, 0.2 + energy * 0.19, random() * Math.PI);
  fillCloud(context, center.x + radius * 0.22, center.y - radius * 0.08, radius * 0.66, radius * 0.2, course.palette.accent, 0.16 + energy * 0.14, random() * Math.PI);

  const cloudCount = Math.min(34, 12 + Math.ceil(Math.sqrt(course.knowledgeCount) * 1.8));
  for (let index = 0; index < cloudCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.72) * radius * 0.68;
    const colorRoll = random();
    const color = colorRoll < 0.46 ? course.palette.gas : colorRoll < 0.78 ? course.palette.core : course.palette.accent;
    fillCloud(
      context,
      center.x + Math.cos(angle) * distance,
      center.y + Math.sin(angle) * distance * 0.46,
      radius * (0.13 + random() * 0.28),
      radius * (0.035 + random() * 0.1),
      color,
      0.08 + random() * 0.16 + energy * 0.05,
      angle + random() * 0.8,
    );
  }

  context.globalCompositeOperation = 'source-over';
  for (let index = 0; index < 7; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = radius * (0.08 + random() * 0.48);
    fillCloud(
      context,
      center.x + Math.cos(angle) * distance,
      center.y + Math.sin(angle) * distance * 0.35,
      radius * (0.22 + random() * 0.36),
      radius * (0.025 + random() * 0.07),
      course.palette.dust,
      0.5 + random() * 0.28,
      angle + random() * 0.5,
    );
  }

  // Overflow topics remain real data, but become fine particulate density rather than unlimited DOM/canvas stars.
  const particulateCount = Math.min(220, course.ambientDensity * 2);
  context.globalCompositeOperation = 'screen';
  for (let index = 0; index < particulateCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const distance = Math.pow(random(), 0.68) * radius * 0.78;
    context.fillStyle = rgba(index % 4 === 0 ? course.palette.accent : course.palette.star, 0.12 + random() * 0.2);
    context.beginPath();
    context.arc(
      center.x + Math.cos(angle) * distance,
      center.y + Math.sin(angle) * distance * 0.55,
      0.35 + random() * 0.7,
      0,
      Math.PI * 2,
    );
    context.fill();
  }

  course.stars.forEach(star => {
    const position = map(star);
    const starRadius = Math.max(0.9, star.size * scale);
    const glow = context.createRadialGradient(position.x, position.y, 0, position.x, position.y, starRadius * 6.5);
    glow.addColorStop(0, rgba(course.palette.star, star.brightness));
    glow.addColorStop(0.16, rgba(star.cardStatus === 'complete' ? course.palette.accent : course.palette.star, star.brightness * 0.72));
    glow.addColorStop(1, rgba(course.palette.accent, 0));
    context.fillStyle = glow;
    context.beginPath();
    context.arc(position.x, position.y, starRadius * 6.5, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = rgba('#ffffff', Math.min(1, star.brightness + 0.16));
    context.beginPath();
    context.arc(position.x, position.y, starRadius, 0, Math.PI * 2);
    context.fill();
    if (star.cardStatus === 'failed') {
      context.strokeStyle = 'rgba(255, 102, 96, .8)';
      context.lineWidth = Math.max(0.7, scale);
      context.beginPath();
      context.arc(position.x, position.y, starRadius * 2.2, 0, Math.PI * 2);
      context.stroke();
    }
  });
  context.globalCompositeOperation = 'source-over';
}

function buildSceneTexture(scene: NebulaScene): SceneTexture | null {
  const worldWidth = Math.max(1, scene.bounds.maxX - scene.bounds.minX);
  const worldHeight = Math.max(1, scene.bounds.maxY - scene.bounds.minY);
  const scale = Math.min(1, 3800 / worldWidth, 3000 / worldHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(worldWidth * scale));
  canvas.height = Math.max(1, Math.ceil(worldHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  const map = (point: Point): Point => ({
    x: (point.x - scene.bounds.minX) * scale,
    y: (point.y - scene.bounds.minY) * scale,
  });
  scene.courses.forEach(course => paintCourseNebula(context, course, map, scale));
  return { canvas, worldWidth, worldHeight };
}

function pointerDistance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function pointerMidpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

export function KnowledgeNebulaBackground({
  summaries,
  onCourseOpen,
  reducedMotion,
}: KnowledgeNebulaBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textureRef = useRef<SceneTexture | null>(null);
  const cameraRef = useRef<NebulaCamera>({ x: 0, y: 0, zoom: 1 });
  const targetCameraRef = useRef<NebulaCamera>({ x: 0, y: 0, zoom: 1 });
  const pointerRef = useRef<PointerState & { inside: boolean }>({ x: 0, y: 0, type: 'mouse', inside: false });
  const activePointersRef = useRef(new Map<number, PointerState>());
  const pinchRef = useRef<PinchState | null>(null);
  const draggingRef = useRef(false);
  const hotspotRefs = useRef(new Map<string, HTMLButtonElement>());
  const pausedRef = useRef(false);
  const animationRef = useRef<number | null>(null);
  const [viewport, setViewport] = useState<Size>(() => ({
    width: typeof window === 'undefined' ? 1280 : Math.max(1, window.innerWidth),
    height: typeof window === 'undefined' ? 720 : Math.max(1, window.innerHeight),
  }));
  const [zoomLabel, setZoomLabel] = useState(1);
  const [canvasFallback, setCanvasFallback] = useState(false);
  const scene = useMemo(() => layoutNebulaScene(summaries), [summaries]);
  const shouldReduceMotion = reducedMotion ?? (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );
  const hasKnowledge = summaries.some(summary => summary.knowledgeCount > 0);

  useEffect(() => {
    if (!hasKnowledge) return undefined;
    const measure = () => {
      const bounds = containerRef.current?.getBoundingClientRect();
      setViewport({
        width: Math.max(1, bounds?.width || window.innerWidth || 1280),
        height: Math.max(1, bounds?.height || window.innerHeight || 720),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [hasKnowledge]);

  useEffect(() => {
    if (!hasKnowledge) {
      pausedRef.current = false;
      return undefined;
    }
    const handleVisibility = () => {
      pausedRef.current = document.visibilityState === 'hidden';
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [hasKnowledge]);

  useEffect(() => {
    if (!hasKnowledge) {
      textureRef.current = null;
      setCanvasFallback(canvasRef.current?.getContext('2d') == null);
      return;
    }
    const fitted = fitScene(scene.bounds, viewport, 96);
    cameraRef.current = fitted;
    targetCameraRef.current = fitted;
    setZoomLabel(fitted.zoom);
    textureRef.current = buildSceneTexture(scene);
    setCanvasFallback(textureRef.current === null || canvasRef.current?.getContext('2d') == null);
  }, [hasKnowledge, scene, viewport]);

  const drawFrame = useCallback((time: number) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    const texture = textureRef.current;
    if (!canvas || !context || !texture) return;
    const dpr = Math.min(viewport.width < 680 ? 1.25 : 1.6, window.devicePixelRatio || 1);
    const pixelWidth = Math.max(1, Math.round(viewport.width * dpr));
    const pixelHeight = Math.max(1, Math.round(viewport.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const camera = cameraRef.current;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, pixelWidth, pixelHeight);
    context.fillStyle = '#010207';
    context.fillRect(0, 0, pixelWidth, pixelHeight);
    context.save();
    context.setTransform(
      dpr * camera.zoom,
      0,
      0,
      dpr * camera.zoom,
      -camera.x * dpr * camera.zoom,
      -camera.y * dpr * camera.zoom,
    );
    context.globalAlpha = shouldReduceMotion ? 1 : 0.97 + Math.sin(time * 0.00042) * 0.025;
    context.drawImage(
      texture.canvas,
      scene.bounds.minX,
      scene.bounds.minY,
      texture.worldWidth,
      texture.worldHeight,
    );
    context.restore();

    scene.courses.forEach(course => {
      const element = hotspotRefs.current.get(course.courseId);
      if (!element) return;
      const position = worldToScreen(course, camera);
      const visible = position.x > -180 && position.x < viewport.width + 180
        && position.y > -100 && position.y < viewport.height + 100;
      element.style.transform = `translate3d(${position.x}px, ${position.y}px, 0) translate(-50%, -50%)`;
      element.style.opacity = visible ? '1' : '0';
      element.style.pointerEvents = visible ? 'auto' : 'none';
    });
  }, [scene, shouldReduceMotion, viewport]);

  useEffect(() => {
    if (!hasKnowledge) return undefined;
    let active = true;
    let lastReportedZoom = cameraRef.current.zoom;
    const animate = (time: number) => {
      if (!active) return;
      if (!pausedRef.current) {
        const pointer = pointerRef.current;
        if (pointer.inside && pointer.type === 'mouse' && !draggingRef.current) {
          const velocity = edgePanVelocity(pointer, viewport);
          const target = targetCameraRef.current;
          targetCameraRef.current = clampCamera({
            ...target,
            x: target.x + velocity.x / target.zoom,
            y: target.y + velocity.y / target.zoom,
          }, scene.bounds, viewport);
        }
        const current = cameraRef.current;
        const target = targetCameraRef.current;
        const easing = shouldReduceMotion ? 1 : 0.14;
        cameraRef.current = {
          x: current.x + (target.x - current.x) * easing,
          y: current.y + (target.y - current.y) * easing,
          zoom: current.zoom + (target.zoom - current.zoom) * easing,
        };
        if (Math.abs(lastReportedZoom - cameraRef.current.zoom) > 0.006) {
          lastReportedZoom = cameraRef.current.zoom;
          setZoomLabel(cameraRef.current.zoom);
        }
        drawFrame(time);
      }
      animationRef.current = requestAnimationFrame(animate);
    };
    drawFrame(0);
    animationRef.current = requestAnimationFrame(animate);
    return () => {
      active = false;
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    };
  }, [drawFrame, hasKnowledge, scene.bounds, shouldReduceMotion, viewport]);

  const applyCamera = useCallback((camera: NebulaCamera) => {
    targetCameraRef.current = camera;
    if (shouldReduceMotion) cameraRef.current = camera;
    setZoomLabel(camera.zoom);
  }, [shouldReduceMotion]);

  const zoomBy = useCallback((factor: number) => {
    const target = targetCameraRef.current;
    applyCamera(zoomAtPoint(
      target,
      { x: viewport.width / 2, y: viewport.height / 2 },
      target.zoom * factor,
      scene.bounds,
      viewport,
    ));
  }, [applyCamera, scene.bounds, viewport]);

  const fitAll = useCallback(() => applyCamera(fitScene(scene.bounds, viewport, 96)), [applyCamera, scene.bounds, viewport]);

  useEffect(() => {
    if (!hasKnowledge) return undefined;
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = canvas.getBoundingClientRect();
      const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      const target = targetCameraRef.current;
      applyCamera(zoomAtPoint(
        target,
        point,
        target.zoom * Math.exp(-event.deltaY * 0.0015),
        scene.bounds,
        viewport,
      ));
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [applyCamera, hasKnowledge, scene.bounds, viewport]);

  const localPointer = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): PointerState => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top, type: event.pointerType };
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const pointer = localPointer(event);
    activePointersRef.current.set(event.pointerId, pointer);
    pointerRef.current = { ...pointer, inside: true };
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length === 2) {
      pinchRef.current = {
        distance: Math.max(1, pointerDistance(pointers[0], pointers[1])),
        midpoint: pointerMidpoint(pointers[0], pointers[1]),
        camera: { ...targetCameraRef.current },
      };
    }
  }, [localPointer]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const next = localPointer(event);
    const previous = activePointersRef.current.get(event.pointerId);
    pointerRef.current = { ...next, inside: true };
    if (!previous) return;
    activePointersRef.current.set(event.pointerId, next);
    const pointers = Array.from(activePointersRef.current.values());
    if (pointers.length >= 2 && pinchRef.current) {
      const pinch = pinchRef.current;
      const distance = Math.max(1, pointerDistance(pointers[0], pointers[1]));
      const midpoint = pointerMidpoint(pointers[0], pointers[1]);
      const zoomed = zoomAtPoint(
        pinch.camera,
        pinch.midpoint,
        pinch.camera.zoom * (distance / pinch.distance),
        scene.bounds,
        viewport,
      );
      applyCamera(clampCamera({
        ...zoomed,
        x: zoomed.x - (midpoint.x - pinch.midpoint.x) / zoomed.zoom,
        y: zoomed.y - (midpoint.y - pinch.midpoint.y) / zoomed.zoom,
      }, scene.bounds, viewport));
      return;
    }
    const target = targetCameraRef.current;
    applyCamera(clampCamera({
      ...target,
      x: target.x - (next.x - previous.x) / target.zoom,
      y: target.y - (next.y - previous.y) / target.zoom,
    }, scene.bounds, viewport));
  }, [applyCamera, localPointer, scene.bounds, viewport]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    activePointersRef.current.delete(event.pointerId);
    if (activePointersRef.current.size < 2) pinchRef.current = null;
    if (activePointersRef.current.size === 0) draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden bg-[#010207]"
      data-canvas-fallback={canvasFallback ? 'true' : undefined}
    >
      {!hasKnowledge ? <AstronomyBackdrop variant="dormant" /> : null}
      {hasKnowledge ? (
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_74%_20%,rgba(24,66,91,.16),transparent_34%),radial-gradient(circle_at_18%_76%,rgba(102,22,48,.13),transparent_38%),linear-gradient(145deg,#010207_0%,#030713_55%,#010207_100%)]"
          data-nebula-scene-wash="true"
        />
      ) : null}
      <canvas
        ref={canvasRef}
        data-nebula-canvas="true"
        className={`absolute inset-0 h-full w-full cursor-grab touch-none active:cursor-grabbing ${!hasKnowledge ? 'hidden' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onPointerEnter={event => {
          pointerRef.current = { ...localPointer(event), inside: true };
        }}
        onPointerLeave={event => {
          if (activePointersRef.current.size === 0) draggingRef.current = false;
          pointerRef.current = { ...localPointer(event), inside: false };
        }}
        aria-hidden="true"
      />

      {hasKnowledge ? (
        <div className="pointer-events-none absolute inset-0 z-20" aria-label="课程星云">
          {scene.courses.map(course => (
            <button
              key={course.courseId}
              ref={element => {
                if (element) hotspotRefs.current.set(course.courseId, element);
                else hotspotRefs.current.delete(course.courseId);
              }}
              type="button"
              aria-label={`打开课程：${course.courseName}`}
              onClick={() => onCourseOpen(course.courseId)}
              className="pointer-events-auto absolute left-0 top-0 min-w-36 rounded-2xl border border-white/10 bg-[#040914]/55 px-4 py-3 text-left text-[#edf7fc] opacity-0 shadow-[0_16px_50px_rgba(0,0,0,.38)] backdrop-blur-md transition-[border-color,background-color,opacity] hover:border-[#77dbea]/45 hover:bg-[#07111d]/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#72d9e8]"
            >
              <span className="block font-song text-base font-bold tracking-wide">{course.courseName}</span>
              <span className="mt-1 block font-mono text-[9px] tracking-[0.14em] text-[#71879a]">
                {course.documentCount} 份课件 · {course.knowledgeCount} 个知识点
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {hasKnowledge ? (
        <NebulaViewportControls
          zoom={zoomLabel}
          onZoomIn={() => zoomBy(1.22)}
          onZoomOut={() => zoomBy(1 / 1.22)}
          onFit={fitAll}
        />
      ) : null}
    </div>
  );
}
