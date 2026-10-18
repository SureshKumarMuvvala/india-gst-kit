---
"@india-gst-kit/gsp": minor
---

Initial release: client for the NIC e-invoice (IRP) and e-way bill APIs. Provider interface (direct NIC now, GSP adapters later); node:crypto login (RSA PKCS#1 v1.5), AppKey (16 or 32 bytes), SEK, AES-ECB payloads and the e-way bill rek/HMAC path; per-GSTIN session cache with no extension on re-auth, forced refresh only in the last 10 minutes and one login in flight; injectable fetch, clock, sleep and random source; redaction of secrets; typed result/error model; GSTIN lookup with a normalised result; e-invoice auth, GSTIN details/sync, generate/cancel/get IRN, IRN by document, EWB by IRN; e-way bill auth, generate, vehicle update, cancel, extend, consolidated, update transporter, reject, GSTIN details; time-limit pre-checks that only warn. All API facts are UNVERIFIED until the first live sandbox call.
