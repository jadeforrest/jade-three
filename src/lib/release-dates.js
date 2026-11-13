/**
 * Release-date rules shared by the site build and the Node scripts.
 *
 * A release stays off the site until its releaseDate (in releases.json) has
 * arrived in Portland. The site is static, so "arrived" means "on the day the
 * build runs": a page only appears once a build runs on or after its date.
 *
 * Plain JS rather than TS because the launchd jobs run on Node 20, which can't
 * import .ts files.
 */

export const SITE_TIME_ZONE = 'America/Los_Angeles';

/**
 * Today's date as YYYY-MM-DD in the site's time zone. Netlify builds run in
 * UTC, so the zone has to be explicit or a release would appear at 4–5 PM the
 * day before.
 * @param {Date} [now]
 * @param {string} [timeZone]
 * @returns {string}
 */
export function siteToday(now = new Date(), timeZone = SITE_TIME_ZONE) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * YYYY-MM-DD strings compare correctly as text.
 * @param {string} releaseDate
 * @param {string} today
 */
export function isReleased(releaseDate, today) {
  return releaseDate <= today;
}

/**
 * IDs of releases that must not appear yet.
 * @param {{ id: string, releaseDate: string }[]} releases
 * @param {string} today
 * @returns {Set<string>}
 */
export function unreleasedIds(releases, today) {
  return new Set(releases.filter((r) => !isReleased(r.releaseDate, today)).map((r) => r.id));
}

/**
 * The day before a YYYY-MM-DD date.
 * @param {string} date
 */
export function dayBefore(date) {
  return new Date(Date.parse(`${date}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/**
 * Releases whose date fell after `lastChecked` and on or before `today`: the
 * ones that went live since the last check.
 * @template {{ releaseDate: string }} R
 * @param {R[]} releases
 * @param {string} lastChecked
 * @param {string} today
 * @returns {R[]}
 */
export function releasedSince(releases, lastChecked, today) {
  return releases.filter((r) => r.releaseDate > lastChecked && isReleased(r.releaseDate, today));
}
