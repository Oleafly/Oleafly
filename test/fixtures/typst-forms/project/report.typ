#import "@local/acme-report:0.1.0" as acme
#import "@local/acme-report:0.1.0": info-box, status-badge as badge
#import "template/memo.typ": memo-header
#set page(paper: "a4")
#set text(lang: "en")

#acme.cover-page(
  title: "Quarterly operations report",
  subtitle: "Third quarter, 2026",
  confidential: true,
)

= Summary

#info-box(title: "Key result", tone: "note")[Deliveries rose by *12%* over the quarter.]

The plan is currently #badge("review") and waits for the board.

#info-box(
  title: "Supply risk",
  tone: "risk",
)[
  Two suppliers missed their delivery dates. The appendix lists them.
]

= Actions

#memo-header(to: "Operations team", subject: "Follow-up actions")

Each team lead confirms their actions by Friday.

#acme.sign-off(name: "Dana Smith", revision: 3, final: false)
