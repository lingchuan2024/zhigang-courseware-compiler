import { describe, expect, it } from 'vitest';
import type { CourseNebulaSummary } from '../../../types';
import { layoutNebulaScene } from '../nebula-layout';

function summary(courseId: string, knowledgeCount: number): CourseNebulaSummary {
  return {
    version: 1,
    courseId,
    courseName: courseId,
    documentCount: 1,
    knowledgeCount,
    completedCardCount: 0,
    updatedAt: 1,
    paletteId: 'crimson-cyan',
    seed: courseId.split('').reduce((total, value) => total + value.charCodeAt(0), 0),
    stars: Array.from({ length: knowledgeCount }, (_, index) => ({
      key: `${courseId}-${index}`,
      name: `topic-${index}`,
      sourceDocumentCount: index % 3 + 1,
      evidenceCount: index % 5 + 1,
      importance: index % 4 === 0 ? 'core' : 'important',
      cardStatus: index % 5 === 0 ? 'complete' : 'none',
    })),
  };
}

describe('layoutNebulaScene', () => {
  it('is deterministic and gives every course a distinct center', () => {
    const input = [summary('course-a', 4), summary('course-b', 9), summary('course-c', 16)];
    const first = layoutNebulaScene(input);

    expect(first).toEqual(layoutNebulaScene(input));
    expect(new Set(first.courses.map(course => `${course.x}:${course.y}`)).size).toBe(first.courses.length);
  });

  it('grows nebula radius with real knowledge quantity and caps bright stars', () => {
    const scene = layoutNebulaScene([summary('small', 2), summary('large', 180)]);
    const small = scene.courses.find(course => course.courseId === 'small')!;
    const large = scene.courses.find(course => course.courseId === 'large')!;

    expect(large.radius).toBeGreaterThan(small.radius);
    expect(large.stars.length).toBe(120);
    expect(large.ambientDensity).toBe(60);
  });

  it('never creates bright stars for an empty course summary', () => {
    const course = layoutNebulaScene([summary('empty', 0)]).courses[0];
    expect(course.stars).toEqual([]);
    expect(course.ambientDensity).toBe(0);
  });

  it('caps the full scene at 600 bright stars', () => {
    const scene = layoutNebulaScene(Array.from({ length: 8 }, (_, index) => summary(`course-${index}`, 120)));
    expect(scene.courses.reduce((total, course) => total + course.stars.length, 0)).toBeLessThanOrEqual(600);
  });
});
