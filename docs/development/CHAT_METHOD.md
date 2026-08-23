# The C.H.A.T. method, as it was taught

> It’s a great day to…
> **C**ontent · **H**eart · **A**pplication · **T**estimony

This is the source text. It is transcribed from the original page the method was
written on, and it is the thing every other description in this repository is a
shortening of — the four blurbs on About and `/welcome`, the one-line prompt on
each card in the editor, the section meanings handed to the assistant, and the
framework section of [`PRODUCT.md`](./PRODUCT.md).

It lives in code as well as here: [`packages/shared/src/chat-method.ts`](../../packages/shared/src/chat-method.ts)
holds the same text, and the application, the AI prompt and the `/method` page
all read it from there. **Change it in one place and everything follows; change
a copy of it and you have created the drift this file exists to end.**

## C — Content

**Focus.**

> Read the Scripture, and allow God to speak that word to you by focusing on one
> main thought from your daily reading — not five, not ten. One thing. Highlight
> a verse or a thought.

The emphasis is focus rather than volume. One thought held long enough to sink
in beats a chapter read and forgotten.

Guiding questions:

- Which single verse or thought are you staying with today?
- What made you stop at that one rather than another?
- What does the passage plainly say, before you interpret it?

## H — Heart

**Meditate.**

> Context. Meditate on the Scripture. Observe carefully what the verse says, and
> take several moments to meditate on it, to let its message soak clear through
> to your heart.

Two motions, and the order matters: observe what is actually there, then stay
with it until it stops being information.

Guiding questions:

- Who was this said to, and what was happening around it?
- What does it say about God, and about the people in it?
- What has it stirred, comforted or unsettled in you?

## A — Application

**Personal.**

> Personal. Application is what seals God’s Word to our hearts. Biblical
> knowledge without a commitment to applying it to life leads only to
> miscomprehension.

The second sentence is the one that is easiest to drop and most costly to lose.
Application is not an optional fourth question about what you might do; the
method's claim is that knowledge never applied is not yet understanding.

Guiding questions:

- What does this ask of you, in particular, this week?
- What is one thing you will actually do about it?
- Where would somebody see this in how you live?

## T — Testimony

**God-glorifying.**

> God-glorifying. The focus should be on the Lord and His faithfulness.
> Testimony is a wonderful way to cement everything that has just happened in
> your life.

Testimony has a subject, and it is not the writer. This is the definition the
application guards hardest, because it is the one a language model will lose on
its own: asked to help with a section called "Testimony", a model with only a
label to work from writes an inspirational closing paragraph. The method's T is
about what God has actually done.

Guiding questions:

- What has God done that you want to remember?
- Where have you seen His faithfulness in this?
- What would you say to somebody who needed to hear it?

## One movement

The four are not four boxes:

**Scripture → Understand → Internalize → Live → Remember and share**

## The verse it comes from

> Keep this Book of the Law always on your lips; meditate on it day and night,
> so that you may be careful to do everything written in it. Then you will be
> prosperous and successful.
>
> — Joshua 1:8 (NIV)

The method is that verse worked out in practice: keep it on your lips (Content),
meditate on it day and night (Heart), be careful to do everything written in it
(Application), and what follows is what a testimony turns out to be about.

## Where this text is used

| Surface | What it shows | Source |
| --- | --- | --- |
| `/method` | All of the above, set as a page | `web_app/src/legal/MethodPage.tsx` |
| `/about`, `/welcome` | Four short blurbs, linking here | `web_app/src/shared/ui/ChatLetters.tsx` |
| The editor | One prompt per card | `web_app/src/chat/sections.ts` |
| The AI system instruction | The definitions, the movement, the verse, and the Testimony constraint | `api/src/ai/prompt.ts` |
| An AI guidance request | The definition and standing questions **for the sections asked about only** | `api/src/ai/prompt.ts` |

The short surfaces are deliberately modern and brief — this is not restated on
a card somebody is trying to write in. What they may not do is drift: the
interpretation has to stay faithful to the text above, and
`api/src/ai/method-context.test.ts` and `web_app/src/legal/MethodPage.test.tsx`
fail if the two clauses most easily lost — Application's warning and Testimony's
subject — stop reaching the model or the reader.

## A note on the Scripture text

This project does not keep passage text on disk; the passage store will not even
cache one, because a translation's licence is about storing books and
substantial portions of them. Joshua 1:8 above is the single deliberate
exception — one verse, quoted with its translation named, because the method
does not read as a method without it.
