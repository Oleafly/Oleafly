#let sender = (
  name: "Your Name",
  role: "Software Engineer",
  address: ("123 Example Street", "City, ST 00000"),
  phone: "+1 (555) 123-4567",
  email: "you@example.com",
)
#let recipient = (
  [Dr. Alex Rivera],
  [Hiring Manager],
  [Example Company],
  [456 Business Avenue],
  [City, ST 00000],
)
#let date = datetime.today().display("[month repr:long] [day padding:none], [year]")
#let subject = [Application for the Research Engineer position]
#let accent = rgb("#3d4f63")

#set document(title: subject, author: sender.name)
#set page(paper: "a4", margin: (x: 2.5cm, top: 2.2cm, bottom: 2.5cm))
#set text(font: "Libertinus Serif", size: 11pt, lang: "en")
#set par(justify: true, leading: 0.68em, spacing: 1.15em)

#grid(
  columns: (1fr, auto),
  align: (left + bottom, right + bottom),
  text(size: 22pt, weight: "bold", fill: accent, sender.name),
  text(size: 9.5pt, fill: luma(80))[
    #for entry in sender.address [#entry \ ]
    #sender.phone \
    #link("mailto:" + sender.email, sender.email)
  ],
)
#v(-0.3em)
#line(length: 100%, stroke: 1pt + accent)
#v(1.4cm)

#grid(
  columns: (1fr, auto),
  align: (left + top, right + top),
  recipient.join(linebreak()),
  date,
)
#v(1cm)

#text(weight: "bold")[Subject: #subject]
#v(0.4em)

Dear Dr. Rivera,

I am writing to apply for the Research Engineer position on your team. I have
five years of experience building data tools for research groups. I would like
to bring that experience to your work.

Replace this paragraph with the main point of your letter. Say what you want
and why you are a good fit. Give one or two concrete examples. Keep each
paragraph short and specific so the reader can skim it.

Close with the next step you would like. For example, ask for a short call or
offer to send more details. Thank the reader for their time.

#v(0.6em)
Sincerely,
#v(1.6cm)
#line(length: 5cm, stroke: 0.5pt + luma(150))
#v(-0.4em)
*#sender.name* \
#text(fill: luma(80), sender.role)

#v(1fr)
#text(size: 9.5pt, fill: luma(80))[Enclosure: Résumé]
