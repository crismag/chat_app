/*
 * What each formatting button produces.
 *
 * These are the functions the buttons and the keyboard shortcuts both call, so
 * every claim here is a claim about both. The caret positions are asserted as
 * carefully as the text: a button that formats correctly and drops the caret
 * to the end of the note is a button people press once.
 */
import { describe, expect, test } from 'vitest'
import {
  UNDERLINE,
  plainPreview,
  toggleBullets,
  toggleTaskAt,
  toggleTasks,
  wrapSelection,
} from './format.ts'

describe('bold, italic and underline', () => {
  test('wraps the selection and keeps it selected', () => {
    const edit = wrapSelection('hello world', 6, 11, '**')
    expect(edit.text).toBe('hello **world**')
    expect(edit.text.slice(edit.start, edit.end)).toBe('world')
  })

  test('with nothing selected it opens a pair and puts the caret inside', () => {
    const edit = wrapSelection('hello ', 6, 6, '**')
    expect(edit.text).toBe('hello ****')
    expect(edit.start).toBe(8)
    expect(edit.end).toBe(8)
  })

  test('pressing it again takes the formatting off', () => {
    /* Selecting the marks themselves. */
    const off = wrapSelection('hello **world**', 6, 15, '**')
    expect(off.text).toBe('hello world')
  })

  test('and takes it off when only the words are selected', () => {
    /* The ordinary case: double-click the word, press Bold again. */
    const off = wrapSelection('hello **world**', 8, 13, '**')
    expect(off.text).toBe('hello world')
    expect(off.text.slice(off.start, off.end)).toBe('world')
  })

  test('italic and underline use their own marks', () => {
    expect(wrapSelection('word', 0, 4, '*').text).toBe('*word*')
    expect(wrapSelection('word', 0, 4, UNDERLINE).text).toBe('++word++')
  })
})

describe('bulleted lists', () => {
  test('every touched line gets a bullet', () => {
    const edit = toggleBullets('milk\neggs\nbread', 0, 15)
    expect(edit.text).toBe('- milk\n- eggs\n- bread')
  })

  test('a list already bulleted loses them', () => {
    const edit = toggleBullets('- milk\n- eggs', 0, 13)
    expect(edit.text).toBe('milk\neggs')
  })

  /*
   * The most common mixed selection: somebody started a list, wrote a line
   * without a dash, and selected both. Requiring uniformity to add would make
   * the button appear broken exactly there.
   */
  test('a half-formatted selection becomes all list', () => {
    const edit = toggleBullets('- milk\neggs', 0, 11)
    expect(edit.text).toBe('- milk\n- eggs')
  })

  test('blank lines are left alone rather than given empty bullets', () => {
    const edit = toggleBullets('milk\n\neggs', 0, 10)
    expect(edit.text).toBe('- milk\n\n- eggs')
  })

  test('indentation is kept, so a nested line stays nested', () => {
    const edit = toggleBullets('  milk', 0, 6)
    expect(edit.text).toBe('  - milk')
  })

  test('a task line becomes a plain bullet rather than gaining a second dash', () => {
    const edit = toggleBullets('- [ ] milk', 0, 10)
    expect(edit.text).toBe('- milk')
  })
})

describe('task lists', () => {
  test('lines become unticked tasks', () => {
    const edit = toggleTasks('milk\neggs', 0, 9)
    expect(edit.text).toBe('- [ ] milk\n- [ ] eggs')
  })

  test('pressing it again leaves plain lines, ticked or not', () => {
    const edit = toggleTasks('- [x] milk\n- [ ] eggs', 0, 21)
    expect(edit.text).toBe('milk\neggs')
  })

  test('a bullet becomes a task without doubling the dash', () => {
    const edit = toggleTasks('- milk', 0, 6)
    expect(edit.text).toBe('- [ ] milk')
  })
})

describe('ticking a task', () => {
  test('by position among tasks, not by line', () => {
    const note = '# Shopping\n\n- [ ] milk\n\nsome prose\n\n- [ ] eggs'
    expect(toggleTaskAt(note, 1)).toContain('- [x] eggs')
    expect(toggleTaskAt(note, 1)).toContain('- [ ] milk')
  })

  test('ticking a ticked task unticks it', () => {
    expect(toggleTaskAt('- [x] milk', 0)).toBe('- [ ] milk')
  })

  test('an index with no task behind it changes nothing', () => {
    expect(toggleTaskAt('- [ ] milk', 7)).toBe('- [ ] milk')
  })

  test('an uppercase X counts as done', () => {
    expect(toggleTaskAt('- [X] milk', 0)).toBe('- [ ] milk')
  })
})

describe('the one-line preview', () => {
  test('formatting comes off', () => {
    expect(plainPreview('**Groceries** for *tonight*')).toBe('Groceries for tonight')
  })

  test('underline and code come off too', () => {
    expect(plainPreview('++note++ and `code`')).toBe('note and code')
  })

  test('bullets and headings come off, and lines join up', () => {
    expect(plainPreview('# Shopping\n- milk\n- eggs')).toBe('Shopping milk eggs')
  })

  /* Whether something is done is the most useful thing this short line has. */
  test('a finished task keeps its mark', () => {
    expect(plainPreview('- [x] milk\n- [ ] eggs')).toBe('✓ milk eggs')
  })

  test('an empty note previews as nothing', () => {
    expect(plainPreview('   \n\n')).toBe('')
  })
})
