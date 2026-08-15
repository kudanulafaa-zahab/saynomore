/**
 * What is actually live right now.
 *
 * Ali, 2026-08-15: *"After this always remember to deploy to production. I do
 * not want to remind you every time."*
 *
 * He had to ask "is it deployed" twice, and both times the honest answer was
 * "half of it". The rule already existed in writing — "merged is not live" —
 * and existed did not help, because there was no way to CHECK it without
 * logging into Vercel. Anything that depends on remembering will eventually be
 * forgotten; anything a command can answer will not.
 *
 * So the running app now states which commit it is. `npm run shipped` reads
 * this and compares it to origin/main, and that is the definition of done —
 * not "pushed", not "merged", not "CI green".
 *
 * PUBLIC ON PURPOSE, and safe: the repository is public, so a commit SHA
 * reveals nothing that GitHub does not already publish. Nothing about the
 * business, the data or the environment is exposed here — and a version
 * endpoint that needed a login could not answer the one question it exists for
 * ("is the new build out there?") from outside the app.
 */

import { NextResponse } from "next/server";

// Read at request time, not baked into a static page: a cached response would
// happily keep reporting the previous deployment's SHA, which is precisely the
// lie this endpoint exists to make impossible.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      // Vercel sets these for every git-triggered build. Locally they are
      // absent, and "dev" is the honest answer there.
      sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "dev",
      ref: process.env.VERCEL_GIT_COMMIT_REF ?? "local",
      env: process.env.VERCEL_ENV ?? "development",
    },
    { headers: { "cache-control": "no-store" } },
  );
}
