import { CourseDetail } from '../services/CacheService';

/**
 * Resolves course details by checking the runtime cache first.
 * If uncached or uncatalogued, returns a clean empty detail object without synthetic placeholders.
 */
export function getCourseDetailFor(
  courseCode: string,
  courseTitle: string,
  instructor: string,
  cachedMap?: Record<string, CourseDetail>
): CourseDetail {
  const code = (courseCode || '').trim().toUpperCase();

  // 1. Check cached details from portal scraper / HTTP client
  if (cachedMap && cachedMap[code]) {
    const cached = cachedMap[code];
    return {
      ...cached,
      courseTitle: courseTitle || cached.courseTitle,
      instructors: instructor || cached.instructors,
    };
  }

  // 2. Clean fallback structure without assumptions or synthetic placeholders
  return {
    courseCode: code,
    courseTitle: courseTitle || code,
    credits: '',
    slot: '',
    instructors: instructor || 'Instructor Not Assigned',
    tutors: '',
    teachingAssistants: '',
    prerequisites: '',
    otherPrerequisites: '',
    learningObjectives: [],
    textBooks: [],
    referenceBooks: [],
    content: '',
    remark: '',
  };
}
