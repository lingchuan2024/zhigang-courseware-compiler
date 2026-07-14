import type { CourseNebulaSummary, KnowledgeStarSummary, NebulaCardStatus } from '../../types';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface SceneBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface NebulaPalette {
  id: string;
  core: string;
  gas: string;
  accent: string;
  dust: string;
  star: string;
}

export interface LayoutKnowledgeStar extends Point {
  key: string;
  name: string;
  size: number;
  brightness: number;
  cardStatus: NebulaCardStatus;
  importance: KnowledgeStarSummary['importance'];
}

export interface LayoutCourseNebula extends Point {
  courseId: string;
  courseName: string;
  documentCount: number;
  knowledgeCount: number;
  radius: number;
  palette: NebulaPalette;
  seed: number;
  stars: LayoutKnowledgeStar[];
  ambientDensity: number;
}

export interface NebulaScene {
  courses: LayoutCourseNebula[];
  bounds: SceneBounds;
}

export const NEBULA_PALETTES: Record<string, NebulaPalette> = {
  'crimson-cyan': {
    id: 'crimson-cyan', core: '#ff5b54', gas: '#a91435', accent: '#59e7ef', dust: '#120914', star: '#fff4dc',
  },
  'carina-amber': {
    id: 'carina-amber', core: '#ffae57', gas: '#b62b42', accent: '#70d8eb', dust: '#17100c', star: '#fff1c7',
  },
  'cobalt-violet': {
    id: 'cobalt-violet', core: '#617cff', gas: '#54207e', accent: '#8df5ef', dust: '#080a22', star: '#eef5ff',
  },
  'oxygen-red': {
    id: 'oxygen-red', core: '#e94f64', gas: '#6d1634', accent: '#41c9e8', dust: '#10070d', star: '#fff0df',
  },
};

const MAX_STARS_PER_COURSE = 120;
const MAX_STARS_PER_SCENE = 600;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function starSize(star: KnowledgeStarSummary): number {
  const importance = star.importance === 'core' ? 2.7 : star.importance === 'important' ? 2 : 1.35;
  return importance + Math.min(1.4, Math.log2(star.evidenceCount + 1) * 0.32);
}

function starBrightness(star: KnowledgeStarSummary): number {
  const sourceBoost = Math.min(4, star.sourceDocumentCount) * 0.065;
  const cardBoost = star.cardStatus === 'complete' ? 0.18 : star.cardStatus === 'partial' ? 0.08 : 0;
  return clamp(0.52 + sourceBoost + cardBoost, 0.52, 1);
}

function layoutStars(
  summary: CourseNebulaSummary,
  center: Point,
  radius: number,
  limit: number,
): LayoutKnowledgeStar[] {
  const random = mulberry32(summary.seed ^ 0x9e3779b9);
  const rotation = random() * Math.PI * 2;
  return summary.stars.slice(0, limit).map(star => {
    const angle = random() * Math.PI * 2 + rotation;
    const radial = Math.pow(random(), 0.64) * radius * 0.82;
    const widthScale = 0.88 + random() * 0.34;
    const heightScale = 0.45 + random() * 0.3;
    return {
      key: star.key,
      name: star.name,
      x: center.x + Math.cos(angle) * radial * widthScale,
      y: center.y + Math.sin(angle) * radial * heightScale,
      size: starSize(star),
      brightness: starBrightness(star),
      cardStatus: star.cardStatus,
      importance: star.importance,
    };
  });
}

function expandedBounds(courses: LayoutCourseNebula[]): SceneBounds {
  if (courses.length === 0) return { minX: -800, minY: -500, maxX: 800, maxY: 500 };
  const padding = 220;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  courses.forEach(course => {
    minX = Math.min(minX, course.x - course.radius - padding);
    minY = Math.min(minY, course.y - course.radius - padding);
    maxX = Math.max(maxX, course.x + course.radius + padding);
    maxY = Math.max(maxY, course.y + course.radius + padding);
  });
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < 1600) {
    const extension = (1600 - width) / 2;
    minX -= extension;
    maxX += extension;
  }
  if (height < 1000) {
    const extension = (1000 - height) / 2;
    minY -= extension;
    maxY += extension;
  }
  return { minX, minY, maxX, maxY };
}

export function layoutNebulaScene(summaries: CourseNebulaSummary[]): NebulaScene {
  const ordered = [...summaries].sort((left, right) => left.courseId.localeCompare(right.courseId));
  let remainingStarBudget = MAX_STARS_PER_SCENE;
  const courses = ordered.map((summary, index) => {
    const radius = clamp(180 + Math.sqrt(summary.knowledgeCount) * 34, 220, 640);
    const ring = index === 0 ? 0 : Math.ceil(Math.sqrt(index));
    const angle = index * GOLDEN_ANGLE + (summary.seed % 360) * (Math.PI / 180) * 0.08;
    const distance = ring * 980;
    const center = {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.68,
    };
    const starLimit = Math.min(MAX_STARS_PER_COURSE, summary.stars.length, remainingStarBudget);
    remainingStarBudget -= starLimit;
    return {
      courseId: summary.courseId,
      courseName: summary.courseName,
      documentCount: summary.documentCount,
      knowledgeCount: summary.knowledgeCount,
      x: center.x,
      y: center.y,
      radius,
      palette: NEBULA_PALETTES[summary.paletteId] ?? NEBULA_PALETTES['crimson-cyan'],
      seed: summary.seed,
      stars: layoutStars(summary, center, radius, starLimit),
      ambientDensity: Math.max(0, summary.knowledgeCount - starLimit),
    } satisfies LayoutCourseNebula;
  });

  return { courses, bounds: expandedBounds(courses) };
}
