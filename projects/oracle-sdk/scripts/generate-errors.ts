/**
 * Script to parse errors.algo.ts and generate SDK error map
 * Parses lines like: export const errName = 'ERR:CODE' // Error message
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

const errorsFilePath = resolve(__dirname, '../../contracts/smart_contracts/oracle/errors.algo.ts')
const outputFilePath = resolve(__dirname, '../src/generated/errors.ts')

const content = readFileSync(errorsFilePath, 'utf-8')

// Match lines like: export const errName = 'ERR:CODE' // Message
const errorRegex = /export const \w+ = '(ERR:[^']+)'\s*\/\/\s*(.+)$/gm

const errors: Record<string, string> = {}
let match: RegExpExecArray | null

while ((match = errorRegex.exec(content)) !== null) {
  const [, code, message] = match
  errors[code] = message.trim()
}

const output = `// Auto-generated from errors.algo.ts - do not edit manually

/**
 * Map of error codes to human-readable error messages
 */
export const ErrorMessages: Record<string, string> = ${JSON.stringify(errors, null, 2)};
`

writeFileSync(outputFilePath, output)
console.log(`Generated ${Object.keys(errors).length} error messages to ${outputFilePath}`)
