#let memo-header(to: none, subject: none) = {
  grid(
    columns: (auto, 1fr),
    column-gutter: 1em,
    row-gutter: 0.6em,
    [*To:*], [#to],
    [*Subject:*], [#subject],
  )
  line(length: 100%)
}
