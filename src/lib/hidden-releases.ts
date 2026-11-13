import releasesData from '../data/releases.json';
import type { ReleasesData } from '../types/releases';
import { siteToday, unreleasedIds } from './release-dates.js';

/**
 * Releases kept off this build because their date hasn't arrived. The dev
 * server shows everything so upcoming releases can be previewed.
 */
export const hiddenReleaseIds: Set<string> = import.meta.env.DEV
  ? new Set()
  : unreleasedIds((releasesData as ReleasesData).releases, siteToday());
