# Scalability diagnosis

This product needs to handle many jobs and many cleaners at once.  
Right now it is built in a way that works for small use, not for very high volume.  
This file is a scan plus proposed solutions — no code was changed yet.

---

## What “high volume” means here

- Many cleaners are online at the same time.
- Many clients or businesses post jobs often.
- Many people keep the app open and wait for updates.

---

## Finding 1 — Finding nearby cleaners is slow at scale

- When a job is posted, the system loads almost all available cleaners from the database.
- Then it checks distance one by one in app code.
- At high volume, this gets slower as the cleaner list grows.

### Proposed solution

- Only ask the database for cleaners near the job location, not the full live list.
- Keep a clear limit (for example nearest N cleaners inside the radius).
- Prefer a “board” pull model too: store the open job once, and let cleaners fetch nearby open jobs, so posting stays light.

---

## Finding 2 — No fast location search

- The database is not set up for “show cleaners near this point” as a fast native query.
- So location matching does extra work that a geo-ready database setup would avoid.

### Proposed solution

- Store cleaner positions in a geo format MongoDB can search fast (for example a `2dsphere` index).
- Use a near-location query when matching jobs to cleaners.
- Update that location when a cleaner goes live or moves, so search stays accurate.

---

## Finding 3 — Too much data stored on one job

- Each notified cleaner is stored as an offer inside that one job record.
- If one job notifies thousands of cleaners, that one record becomes huge.
- Huge records are slower to read, update, and save.

### Proposed solution

- Keep the job document small (status, location, schedule, assigned cleaner).
- Store offers in a separate collection (one row per cleaner per job).
- Cap how many cleaners are notified per job, or switch more of the flow to “cleaners query open jobs nearby.”

---

## Finding 4 — Notifications block the job post

- When a job is posted, the server writes notification rows before finishing the request.
- That work happens in the same moment as posting, not in a separate background system that can retry safely.
- Under heavy load, posting a job can feel slow or fail more easily.

### Proposed solution

- Save the job first, return success to the user quickly, then notify in the background.
- Use a durable queue (saved to disk/database/Redis), not only memory, so work survives restarts.
- Send in batches with retries; add real device push later (for example FCM) for reliability when the app is closed.

---

## Finding 5 — The app keeps asking the server again and again

- Cleaner, client, and admin screens refresh every few seconds.
- Each open browser tab keeps hitting the API even when nothing changed.
- With many users online, this alone can overload the server.

### Proposed solution

- Push updates only when something changes (WebSocket or Server-Sent Events).
- Keep a light fallback poll only if the live connection drops.
- This cuts useless traffic and makes status changes feel faster and more reliable.

---

## Finding 6 — Expiry work runs inside the main API

- Every 10 seconds, the same API process looks for timed-out offers and unmatched jobs.
- It updates them one request at a time.
- If many jobs expire together, this slows the whole API.

### Proposed solution

- Move expiry into a separate worker process.
- Process expired jobs in batches with safe database updates.
- Use indexed expiry times so the worker finds due work quickly, and only one worker claims each job.

---

## Finding 7 — Email queue is only in memory

- Signup emails sit in a list inside the running server process.
- If the server restarts, those waiting emails can be lost.
- This is not a strong setup for high signup volume or multiple servers.

### Proposed solution

- Put email jobs in a durable queue shared by all servers.
- Retry failed sends with a clear limit, and log permanent failures.
- This keeps magic-link signup reliable during restarts and traffic spikes.

---

## Finding 8 — Admin screens load too much at once

- Admin can load all requests and all users with no page limits.
- That is fine with small data.
- With large data, those pages become slow and heavy.

### Proposed solution

- Add pagination (page size + next page) on admin request and user lists.
- Add filters by status, date, and role so admins load only what they need.
- Optionally add summary stats from pre-computed counts instead of loading every row.

---

## Finding 9 — Important database indexes are missing

- Some common searches (my jobs, my offers, open jobs, expiry times) are not clearly indexed for speed.
- Without those indexes, the database does more scanning as data grows.
- That makes lists and matching slower over time.

### Proposed solution

- Add indexes for the real query patterns: client/business jobs, cleaner offers, assigned jobs, status, and expiry times.
- Review slow queries after indexing and keep only indexes that earn their keep.
- Indexes make high volume reads faster and more predictable.

---

## Finding 10 — Outside services can become bottlenecks

- Address geocoding calls an external service during flows that need lat/lng.
- There is little caching or protection if that service is slow or rate-limited.
- High signup or posting volume can stall on geocoding.

### Proposed solution

- Cache geocode results for the same address for a period of time.
- Add timeouts, retries, and a clear user error when geocoding is down.
- Do not let a slow geocode call hold the whole server longer than a short limit.

---

## Finding 11 — One server, one database shape

- The app runs as one API process plus one MongoDB.
- There is no strong split between “handle user clicks” and “do heavy background work.”
- So one busy path can affect everything.

### Proposed solution

- Run several API instances behind a load balancer for user traffic.
- Run separate workers for notify, email, and expiry.
- Use a managed MongoDB setup with backups and monitoring so one machine failure does not take the product down quietly.

---

## What is already okay

- When two cleaners accept at once, the system mostly protects “first accept wins.”
- Notification reads are limited to the latest 50 items.
- Pay data for lists is fetched in a batch, which is better than one query per job.

### Keep and build on this

- Keep the race-safe accept pattern when offers move to a separate collection.
- Keep notification read limits, and add unread counts if needed.
- Keep batched pay loading as lists grow.

---

## Bottom line

- The product purpose needs strong matching, notifying, and live updates.
- Those three areas are the weakest for very high volume today.
- Small traffic can work; large traffic will hit matching, notifications, polling, and expiry first.
- The solutions above aim for both high volume and high reliability: fast user paths, durable background work, and less “load everything” behaviour.
