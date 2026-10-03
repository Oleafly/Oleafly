#set document(title: "Response to reviewers")
#set page(margin: 1in)
#set text(size: 11pt)
#set par(spacing: 0.9em)

#let reply-accent = rgb(0, 90, 140)
#let quote-rule = rgb(160, 160, 160)

#let reviewer(number) = {
  v(1.2em)
  block(width: 100%, stroke: (bottom: 0.5pt + quote-rule), inset: (bottom: 0.4em))[
    #text(size: 1.2em, weight: "bold")[Reviewer #number]
  ]
}

#let point(id, comment) = {
  v(0.6em)
  [*#id* #h(1em) #emph(comment)]
}

#let reply(body) = {
  v(0.3em)
  [#text(fill: reply-accent, weight: "bold")[Response.] #body]
}

#let changed(location, body) = {
  v(0.3em)
  [*Changed in* #raw(location)]
  quote(block: true, body)
}

#let notchanged(body) = {
  v(0.3em)
  [*No change.* #body]
}

#align(center, text(size: 1.6em, weight: "bold")[Response to reviewers])

We thank the reviewers for their careful reading. Reviewer comments are
reproduced in italics, followed by our response and the corresponding change in
the manuscript. Line numbers refer to the revised version.

#reviewer(1)

#point[R1.1][Reviewer comment, reproduced word for word.]
#reply[What we did about it, in one or two sentences.]
#changed("sections/methods.typ, line 84")[The new or revised sentence, quoted exactly as it now appears.]

#point[R1.2][A second comment.]
#reply[Our answer.]
#notchanged[Why the manuscript was not changed, and what we did instead.]

#reviewer(2)

#point[R2.1][A comment from the second reviewer.]
#reply[Our answer.]
#changed("sections/results.typ, line 121")[The revised passage.]
