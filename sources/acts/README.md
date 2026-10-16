# Acts (source G)

Retrieved **2026-10-16** from the GST Council website (gstcouncil.gov.in), which republishes the Acts as Gazette PDFs. Status: **UNVERIFIED — needs CA**.

| File | URL | SHA-256 | Used for |
|---|---|---|---|
| `utgst-act-2017.pdf` | https://gstcouncil.gov.in/sites/default/files/2024-03/anneure_6_utgst-act_2017.pdf (page: https://gstcouncil.gov.in/utgst) | `664cd89c02e1491a866de847c78a6a1850f64d3dd109f3b61e3e10d568547cf2` | s.2(8) "Union territory" → `usesUtgst()` |
| `utgst-amendment-act-2018.pdf` | https://gstcouncil.gov.in/sites/default/files/2024-03/annexure-6-utgst-amendment-act_2018.pdf | `4447a3915cec0eb20d444e8cdc084d5dee027a2672c2166646a646150746f712` | checked: does not change the definition |
| `cgst-act-2017.pdf` | https://gstcouncil.gov.in/sites/default/files/2024-04/annexure-3_cgst-act_2017.pdf (page: https://gstcouncil.gov.in/central-gst) | `f1d3fff5674d8ee255786608923c3ce46651f13993a72e89e01ef3f73aee479c` | s.2(114) "Union territory" (same six territories) |

Definition (UTGST Act s.2(8); CGST Act s.2(114)): Andaman and Nicobar Islands; Lakshadweep; Dadra and Nagar Haveli; Daman and Diu; Chandigarh; other territory.

Limitation: these are the Acts as enacted plus the 2018 amendment. Later changes (Ladakh as a separate UT, the 2020 merger of Dadra and Nagar Haveli with Daman and Diu) were **not** retrieved.

Ladakh search (2026-10-16): the GST Council pages https://gstcouncil.gov.in/utgst and https://gstcouncil.gov.in/central-gst list only the 2017 Acts, the 2018/2023 CGST amendments, the J&K extension Act and the UTGST 2018 amendment; the site search for "ladakh" returns only notifications and Council-meeting papers. No amendment covering Ladakh was found, so `usesUtgst("38")` returns `"unknown"`. To resolve: attach the Gazette text that amends UTGST s.2(8) / CGST s.2(114) for Ladakh.

Not fetched: rate notifications (source F). `taxinformation.cbic.gov.in` fails TLS verification from the build environment; `cbic-gst.gov.in` does not host rates. Deferred (spec §12).
