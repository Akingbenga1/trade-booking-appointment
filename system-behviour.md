# System Behaviour

How the product should behave for each core user.  
Source of truth for journeys and capabilities: `progressive-update.md`.

Matching: nearby cleaners are notified together (open nearby board).  
Responses: accept, reject, and ignore are tracked; first successful accept wins; booking then follows a clear lifecycle.

---

## Shared system rules

These apply across roles.

1. A cleaning need is posted with what, when, and where.
2. The system finds available cleaners closest to that location and notifies that set together.
3. While the request is **Open**, notified cleaners may accept, reject, or ignore.
4. **Accept** — first successful accept assigns the cleaner; request becomes **Assigned**; other notified cleaners are told it is no longer available; their pending offers close.
5. **Reject** — recorded for that cleaner only; request stays **Open** for other notified cleaners.
6. **Ignore** — recorded when the cleaner dismisses the offer or the response window expires; request stays **Open** for others.
7. If no cleaner accepts before the overall matching window ends, the request becomes **Unmatched** and the client/business is informed.
8. After assignment, the booking moves through progress steps until **Completed** (or **Cancelled** where allowed).
9. The system keeps a trail of who was offered and who accepted, rejected, or ignored.

---

## Client / business

### What the system allows

- Sign in as a client or business.
- Post a cleaning need (service details, preferred time, location).
- View their own requests and bookings.
- Track status from open through assigned work to completion (or unmatched / cancelled).
- Cancel or update a request only while it is still open and no cleaner is locked in (before assignment).
- After assignment, see who is assigned and follow job progress.
- Be notified when: nearby cleaners have been notified; a cleaner accepts; matching fails; major booking status changes; the job completes.

### How the system behaves for them

| Situation | System behaviour |
|-----------|------------------|
| They submit a valid cleaning need | Request is created as **Open**; nearby available cleaners are notified; client sees confirmation that matching has started. |
| No cleaners are available nearby | Client is informed that no match was found / request cannot be filled as posted. |
| Cleaners are responding | Client sees the request still **Open** (they do not need the full per-cleaner attempt list unless the product surfaces a simple summary). |
| A cleaner accepts | Request becomes **Assigned**; client sees the assigned cleaner and can follow progress. |
| Other cleaners still had the offer open | Those offers close; client is not left thinking multiple cleaners are assigned. |
| Nobody accepts in time | Request becomes **Unmatched**; client is told and can repost or adjust details. |
| They try to change or cancel after assignment | System blocks or limits that according to “only before cleaner is locked in,” unless admin intervenes. |
| Cleaner updates job progress | Client sees the same progress (e.g. on the way → working → done). |
| Job finished | Client sees **Completed**. |

### What they should not experience

- Being left unsure whether anyone was notified.
- Seeing two cleaners assigned to the same request.
- Losing track of whether the request is still waiting, assigned, unmatched, or done.

---

## Cleaner

### What the system allows

- Sign in as a cleaner.
- Go available (live) with a current location so they can be included in nearby matching.
- Go unavailable so they stop receiving new nearby offers.
- Receive notifications for nearby cleaning needs.
- Open an offer with distance, location context, timing, job details, and a response window.
- Respond with **accept**, **reject**, or **ignore** (including letting the timer expire).
- After accepting: move the job through on-the-way / on-site / in progress / completed style steps.
- See personal history of accepted, rejected, and ignored offers.
- Be notified when: a new nearby request arrives; their accept succeeds; the request was taken by someone else; relevant booking updates.

### How the system behaves for them

| Situation | System behaviour |
|-----------|------------------|
| They are not live / no current location | They are not included in nearby matching for new requests. |
| They are live near a new request | They are included in the notified set; they get a notification and can see the offer. |
| Several cleaners are nearby | All of them see the same open request together (not a hidden one-at-a-time queue). |
| They accept while request is still Open | System assigns them; request becomes **Assigned**; attempt recorded as accepted; others get “no longer available.” |
| They accept after someone else already accepted | Accept is rejected; they are told the job is no longer available. |
| They reject | Attempt recorded as rejected; offer closes for them; request stays open for other notified cleaners. |
| They ignore or the offer timer expires | Attempt recorded as ignored; offer closes for them; request stays open for others. |
| Another cleaner accepts first | Their open offer closes; they see the request as unavailable. |
| They own an assigned booking | Only they can advance that booking’s progress steps until completed. |
| They view history | They see their own outcomes (accepted / rejected / ignored) and completed jobs. |

### What they should not experience

- Receiving offers when they are unavailable (unless explicitly designed otherwise).
- Believing they still have an open offer after another cleaner has taken the job.
- Having a reject or ignore silently disappear with no record on their side / on the request trail.

---

## Admin

### What the system allows

- Sign in to the admin side of the hub.
- View open and historical requests across the platform.
- Open a request and see: current status; who was notified; who accepted, rejected, or ignored.
- Oversee client/business and cleaner accounts.
- Intervene: force-assign a cleaner, resolve a stuck request, or cancel where allowed.
- See overall activity (open, assigned, unmatched, completed).

### How the system behaves for them

| Situation | System behaviour |
|-----------|------------------|
| They open the request list | They can scan by status and recency. |
| They open one request | They see the matching trail and current status, not only a single label. |
| A request is stuck Open with no progress | They can inspect attempts and intervene (force-assign or cancel / resolve). |
| They force-assign a cleaner | Request becomes **Assigned** to that cleaner; conflicting open offers for others are closed; client and cleaner are updated accordingly. |
| They cancel a request | Request becomes **Cancelled**; affected client and any assigned cleaner are informed as appropriate. |
| They review users | They can see and manage client/business and cleaner accounts on the hub. |

### What they should not experience

- Blind status labels with no way to see who was offered or how they responded.
- No path to unstick a request that matching left hanging.

---

## Status behaviour (system-facing summary)

| Status | Meaning | Typical trigger |
|--------|---------|-----------------|
| **Open** | Posted; nearby cleaners notified; waiting for accept | Client submits need; matching started |
| **Assigned** | A cleaner has taken it | First successful accept, or admin force-assign |
| **In progress** | Cleaner is executing the job (includes on-the-way / on-site as shown in product) | Assigned cleaner advances the booking |
| **Completed** | Work finished | Cleaner completes; client sees done |
| **Unmatched** | No cleaner accepted in time | Matching window ends with no accept |
| **Cancelled** | Stopped by client (pre-assign) or admin | Explicit cancel / resolve |

Per cleaner, against each offer: **accepted**, **rejected**, or **ignored**.

---

## Cross-user behaviour checklist

- One request → at most one assigned cleaner at a time.
- Nearby notified set sees the request together while it is Open.
- Reject and ignore never assign the job; they only close that cleaner’s offer.
- Client, cleaner, and admin always see a consistent status for the same request.
- Notifications fire on the moments that change what someone must do next (new offer, assigned, unavailable, unmatched, progress, completed).
