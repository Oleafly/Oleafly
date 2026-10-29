#import "@local/acme-report:0.1.0": *
#import "@local/acme-report:0.1.0" as acme
#let data = (title: "Computed title")
#let extra = (title: "From a dictionary", tone: "risk")
#let note = [#info-box(title: "Inside the settings")[Hidden while the settings are collapsed.]]

= Edge cases

#info-box(title: data.title)[The title is an expression.]

#info-box(..extra)[A spread locks the whole form.]

#info-box(title: "Outer box")[
  The status is #status-badge("draft") inside the body.
]

#info-box(title: "Odd tone", tone: "urgent")[The tone is not one of the options.]

#sign-off(name: "Before the let", revision: 1)

#let sign-off(name: none) = [Signed locally by #name.]

#sign-off(name: "After the let")

#table(columns: 2, [Built-in], [table])

#acme.table(caption: "Qualified form", columns: 2, [Acme], [table])

#note
