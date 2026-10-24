#!/usr/bin/env node
/**
 * skill.mjs - talk to the Virtuoso bridge daemon directly, without the bridge CLI.
 *
 * Why this exists: the CLI opens its own SSH tunnel on a port it reads from
 * `<HOME>\.virtuoso-bridge\.env` (VB_LOCAL_PORT).  When a *stale* listener
 * already occupies that port, the CLI talks to a tunnel whose remote half is
 * dead: TCP connects fine (the kernel accepts) but nothing ever answers, so
 * every call dies with "Socket timeout connecting to 127.0.0.1:65453".
 * This script uses an independent tunnel on a chosen port, which makes it
 * possible to ask the daemon a question while the CLI path is broken.
 *
 * Protocol (replicated from the plugin's daemonCall): send one JSON object
 * `{ skill, timeout }`, half-close (FIN), then read until the daemon closes or
 * sends its 0x15 delimiter.  A healthy answer to `1+1` is STX + "2".
 *
 * Usage: node skill.mjs <port> <timeoutSec> <skill...>
 *        node skill.mjs 65460 10 1+1
 */
import { createConnection } from 'node:net'

const [portArg, timeoutArg, ...rest] = process.argv.slice(2)
if (!portArg || !rest.length) {
  console.error('usage: node skill.mjs <port> <timeoutSec> <skill...>')
  process.exit(2)
}
const port = Number(portArg)
const timeout = Number(timeoutArg || 10)
const skill = rest.join(' ')
const budgetMs = Math.max(4000, (timeout + 5) * 1000)

const started = Date.now()
const chunks = []
let done = false
const finish = (why) => {
  if (done) return
  done = true
  const text = chunks.join('')
  const printable = text.replace(/[\u0000-\u001f]/g, (c) =>
    c === '\u0002' ? '<STX>' : c === '\u0015' ? '<0x15>' : `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
  console.log(`--- ${why} after ${Date.now() - started}ms`)
  console.log(`bytes=${text.length} text=${JSON.stringify(printable)}`)
  process.exit(0)
}

const socket = createConnection({ host: '127.0.0.1', port })
socket.setNoDelay(true)
const timer = setTimeout(() => finish('TIMEOUT (no answer)'), budgetMs)
socket.once('connect', () => {
  const payload = JSON.stringify({ skill, timeout })
  console.log(`connected 127.0.0.1:${port}, sending ${payload.length} bytes`)
  socket.write(payload)
  socket.end()
})
socket.on('data', (buffer) => {
  chunks.push(buffer.toString('utf8'))
  if (chunks.join('').includes('\u0015')) {
    clearTimeout(timer)
    finish('delimiter 0x15 received')
  }
})
socket.once('error', (error) => {
  clearTimeout(timer)
  console.error(`socket error: ${error.code ?? error.message}`)
  process.exit(1)
})
socket.once('close', () => {
  clearTimeout(timer)
  finish(chunks.length ? 'daemon closed the connection' : 'daemon closed with NO bytes')
})
