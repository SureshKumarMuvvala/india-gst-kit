---
"@india-gst-kit/gsp": minor
---

`api` error entries carry `system`, `list`, `category`, `officialMessage`, `userMessage` and `notes` from `@india-gst-kit/errors` (new dependency); new `summarizeGspError`, `decorateApiErrors` and `RawApiError`; `SESSION_ERROR_CODES` re-exported for `authErrorCodes` (default still empty). `describeErrorCode`, `ErrorCodeInfoSchema` and the new `errorCodeTable` option are deprecated: kept for one minor version, a caller table still overrides `officialMessage`.
