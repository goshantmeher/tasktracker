import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Markdown } from '../components/markdown'

// This is the guarantee that makes it safe for an API key to write
// description/requirement/prerequisites/result/notes and have the browser
// render them as markdown: react-markdown without rehype-raw never turns
// text into a real DOM element via dangerouslySetInnerHTML, and its default
// urlTransform strips dangerous URL schemes from links. Proven directly here
// rather than assumed from a manual browser check.

test('a <script> tag written into a markdown field renders as literal text, not a live element', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, '<script>alert(1)</script>'))
  assert.ok(!/<script[\s>]/i.test(html), `expected no live <script> tag in the output, got: ${html}`)
  assert.ok(html.includes('alert(1)'), `expected the text to still be visible (escaped), got: ${html}`)
})

test('a javascript: URL in markdown link syntax is stripped, not left as a live href', () => {
  const html = renderToStaticMarkup(createElement(Markdown, null, '[x](javascript:alert(1))'))
  assert.ok(!html.includes('javascript:'), `expected the javascript: scheme to be stripped, got: ${html}`)
  assert.ok(html.includes('>x<'), `expected the link text to still render, got: ${html}`)
})
